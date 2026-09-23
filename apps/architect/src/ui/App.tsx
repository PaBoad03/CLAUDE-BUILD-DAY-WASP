import { useEffect, useMemo, useState } from 'react';
import { AgentFace3D, AgentsWindow, AuditWindow, CommunicationWindow, EventLog, PermissionsWindow, ResearchStatusWindow, SandboxWindow, TaskWindow, WorkshopWindow, agentTheme, attentionFor, useHub } from '@wasp/ui';
import { AGENT_VOICES, MicLevel, VoiceInput, VoiceOutput } from '@wasp/voice';

/**
 * CYAN face — Pablo's PC. The human talks to WASP here.
 *
 * Dictation: the mic writes into the text box (interim words show in the panel, final sentences are
 * appended to the box). The human reviews and presses SEND — or says "envía" — and the text goes to
 * WASP as user_message from 'human'. CYAN's process answers "Te escuché: …".
 * Exception: while GREEN is waiting for a permission answer, a final "sí" / "no" / "stop" is sent
 * immediately as user_authorization, so approvals stay fast.
 * The mic is muted while this PC's TTS speaks so WASP never hears itself.
 */
export function App() {
  const theme = agentTheme('architect');
  const hub = useHub('architect');
  const voice = useMemo(() => new VoiceOutput(AGENT_VOICES.architect), []);
  const mic = useMemo(() => new VoiceInput({ lang: navigator.language.startsWith('en') ? 'en-US' : 'es-ES' }), []);
  const meter = useMemo(() => new MicLevel(), []);
  const [voiceOn, setVoiceOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [sent, setSent] = useState<{ text: string; kind: 'request' | 'authorization' } | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const awaiting = hub.context?.permissions.find((p) => p.status === 'AWAITING_HUMAN') ?? null;
  const archState = hub.context?.agent_states.architect ?? 'OFFLINE';
  const canSend = hub.status === 'open' && hub.agentProcessOnline && (archState === 'LISTENING' || awaiting !== null);

  const postRequest = async (text: string) => {
    setError(null);
    try {
      await hub.postAsHuman('user_message', { text, channel: listening ? 'voice' : 'ui' }, { to: 'architect' });
      setSent({ text, kind: 'request' });
      setTyped('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const postAuthorization = async (permission_id: string, raw: string, decision: 'YES' | 'NO' | 'STOP' | 'AMBIGUOUS') => {
    setError(null);
    try {
      await hub.postAsHuman('user_authorization', { permission_id, decision, raw, channel: decision === 'AMBIGUOUS' ? 'voice' : 'ui' }, { to: 'security', correlation_id: permission_id });
      setSent({ text: raw, kind: 'authorization' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    voice.onSpeakingChange = (s) => {
      setSpeaking(s);
      mic.muted = s; // do not transcribe our own voice
    };
    voice.onUtterance = (phase, text, ok) => hub.emitTts(phase === 'start' ? 'tts_started' : 'tts_finished', text, ok);
    mic.onListeningChange = (l) => {
      setListening(l);
      if (l) void meter.start();
      else meter.stop();
    };
    mic.onError = (e) => setError(`micrófono: ${e}`);
    meter.onLevel = setLevel;
    meter.onError = (e) => setError(`micrófono: ${e}`);
  }, [voice, mic, meter, hub]);

  // Transcript handler re-bound on every render so it sees the current permission / typed text.
  useEffect(() => {
    mic.onTranscript = (text, final, confidence) => {
      if (!text) return;
      if (!final) {
        setHeard(text);
        return;
      }
      setHeard('');
      hub.emitTranscript(text, true, confidence); // for the event stream / audit
      const clean = text.trim();
      if (awaiting) {
        // GREEN is waiting: the words go straight to it, GREEN decides what they mean
        void postAuthorization(awaiting.permission_id, clean, 'AMBIGUOUS');
        return;
      }
      if (/^(env[ií]a(lo)?|enviar|m[aá]ndalo|send|listo)[.!]?$/i.test(clean)) {
        const current = typed.trim();
        if (current && canSend) void postRequest(current);
        return;
      }
      setTyped((prev) => (prev ? `${prev} ${clean}` : clean));
    };
  });

  useEffect(() => {
    if (hub.lastSpeech) voice.speak(hub.lastSpeech.text);
  }, [hub.lastSpeech, voice]);

  const toggleVoice = () => {
    if (voiceOn) {
      voice.disable();
      setVoiceOn(false);
    } else {
      voice.enable();
      setVoiceOn(true);
      voice.speak('Cyan en línea.');
    }
  };

  const toggleMic = () => {
    if (listening) mic.stop();
    else {
      mic.start();
      if (voiceOn) voice.speak('Te escucho. Dicta tu petición y pulsa enviar, o di "envía".');
    }
  };

  const humanTalking = listening && (heard !== '' || level > 0.12);
  const lookAt = humanTalking ? 'human' : attentionFor('architect', hub.messages);
  const quiet = hub.faceState === 'IDLE' || hub.faceState === 'COMPLETE' || hub.faceState === 'SUCCESS' || hub.faceState === 'WARNING';
  const faceState = listening && quiet ? 'LISTENING' : hub.faceState;
  const detail = hub.status !== 'open' ? 'sin conexión al hub' : !hub.agentProcessOnline ? 'el proceso de CYAN no está corriendo — npm run architect' : hub.faceDetail;

  const sendStatus = !hub.agentProcessOnline
    ? { text: 'CYAN NO ESTÁ CORRIENDO — arranca  npm run architect  (o .\\wasp.ps1)', cls: 'bad' }
    : awaiting
      ? { text: `GREEN ESPERA TU RESPUESTA a "${awaiting.operation}": di o escribe sí, no o stop`, cls: 'warn' }
      : archState === 'LISTENING'
        ? { text: 'CYAN ESCUCHANDO — dicta o escribe tu petición y pulsa SEND (o di "envía")', cls: 'good' }
        : { text: `CYAN OCUPADO (${archState.replace(/_/g, ' ')}) — espera a que termine`, cls: 'muted' };

  return (
    <main className={`screen ${theme.className}`}>
      <div className="crt" aria-hidden="true" />
      <header className="topbar">
        <span className="topbar__brand">WASP</span>
        <span className="topbar__agent">{theme.label}</span>
        <span className={`topbar__conn topbar__conn--${hub.status}`}>HUB {hub.status.toUpperCase()}</span>
        <span className={`topbar__conn topbar__conn--${hub.agentProcessOnline ? 'open' : 'closed'}`}>AGENT {hub.agentProcessOnline ? 'ONLINE' : 'OFFLINE'}</span>
        <span className="topbar__session">{hub.sessionId || 'no session'}</span>
        <button className="btn" onClick={toggleVoice} disabled={!voice.isSupported}>
          {voice.isSupported ? (voiceOn ? 'VOICE ON' : 'ENABLE VOICE') : 'NO TTS'}
        </button>
        <button className={`btn ${listening ? 'btn--live' : ''}`} onClick={toggleMic} disabled={!mic.isSupported} title="Micrófono → dicta en la caja de texto. GREEN decide qué significan las palabras.">
          {mic.isSupported ? (listening ? '● LISTENING' : 'MIC') : 'NO STT'}
        </button>
      </header>
      {error && <p className="degraded">{error}</p>}

      <div className="stage">
        <div className="stage__face">
          <AgentFace3D color={theme.hex} state={faceState} speaking={speaking} label={theme.name} lookAt={lookAt} detail={detail} />

          <section className={`listen ${listening ? 'listen--on' : ''} ${speaking ? 'listen--muted' : ''}`} aria-live="polite">
            <div className="listen__head">
              <span className="listen__dot" />
              <span className="listen__status">
                {!listening ? 'MIC OFF — pulsa MIC o escribe abajo' : speaking ? 'CYAN HABLANDO — micrófono en pausa' : heard ? 'ESCUCHANDO…' : 'TE ESCUCHO — habla'}
              </span>
            </div>
            <div className="listen__meter" aria-hidden="true">
              {Array.from({ length: 24 }, (_, i) => (
                <span key={i} className={`listen__bar ${level * 24 > i ? 'listen__bar--on' : ''}`} />
              ))}
            </div>
            <p className={`listen__text ${heard ? '' : 'listen__text--empty'}`}>{heard || (listening ? '…' : '')}</p>
            {sent && (
              <p className="listen__sent">
                <span className="good">✓ {sent.kind === 'authorization' ? 'respuesta enviada a GREEN' : 'petición enviada a CYAN'}</span> “{sent.text}”
              </p>
            )}
          </section>

          <form
            className="ask"
            onSubmit={(e) => {
              e.preventDefault();
              const text = typed.trim();
              if (!text) return;
              if (awaiting) void postAuthorization(awaiting.permission_id, text, 'AMBIGUOUS');
              else void postRequest(text);
            }}
          >
            <textarea className="ask__input ask__input--multi" rows={3} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Dicta con el MIC o escribe aquí, luego SEND…" />
            <div className="ask__side">
              <button className="btn" type="submit" disabled={!typed.trim() || !canSend}>
                SEND
              </button>
              <button className="btn btn--ghost" type="button" onClick={() => setTyped('')} disabled={!typed}>
                CLEAR
              </button>
            </div>
          </form>
          <p className={`ask__status ${sendStatus.cls}`}>{sendStatus.text}</p>
        </div>

        <div className="stage__windows stage__windows--3">
          <TaskWindow context={hub.context} />
          <AgentsWindow context={hub.context} />
          <PermissionsWindow context={hub.context} onAnswer={(p, decision, raw) => void postAuthorization(p.permission_id, raw, decision)} />
          <WorkshopWindow context={hub.context} />
          <ResearchStatusWindow context={hub.context} />
          <SandboxWindow context={hub.context} />
          <CommunicationWindow messages={hub.messages} rows={5} title="AGENT COMMUNICATION" />
          <AuditWindow context={hub.context} rows={6} />
          <EventLog events={hub.events} rows={10} />
        </div>
      </div>
    </main>
  );
}
