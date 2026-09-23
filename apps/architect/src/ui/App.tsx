import { useEffect, useMemo, useState } from 'react';
import { AgentFace3D, AgentsWindow, AuditWindow, CommunicationWindow, EventLog, PermissionsWindow, ResearchStatusWindow, SandboxWindow, TaskWindow, WorkshopWindow, agentTheme, attentionFor, useHub } from '@wasp/ui';
import { AGENT_VOICES, MicLevel, VoiceInput, VoiceOutput } from '@wasp/voice';

/**
 * CYAN face — Pablo's PC. The human talks to WASP here:
 *   mic → stt_transcript (final) → the architect process (CliHuman) takes it as the request / answer
 *   typed text → user_message from 'human' through the hub HTTP bridge
 * and hears CYAN's lines (agent_message from architect, speak_requested for architect) through TTS.
 *
 * Listening feedback: live mic level meter, the words as they are recognised, a "sent" mark when a
 * sentence is final, and CYAN saying back "Te escuché: …" (spoken by the architect process).
 * The mic is muted while this PC's TTS speaks so WASP never hears itself.
 */
export function App() {
  const theme = agentTheme('architect');
  const hub = useHub('architect');
  const voice = useMemo(() => new VoiceOutput(AGENT_VOICES.architect), []);
  const mic = useMemo(() => new VoiceInput({ lang: navigator.language.startsWith('es') ? 'es-ES' : 'en-US' }), []);
  const meter = useMemo(() => new MicLevel(), []);
  const [voiceOn, setVoiceOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [sent, setSent] = useState<{ text: string; at: number } | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    mic.onError = (e) => setError(`microphone: ${e}`);
    mic.onTranscript = (text, final, confidence) => {
      if (!text) return;
      if (final) {
        setHeard('');
        setSent({ text, at: Date.now() });
      } else {
        setHeard(text);
      }
      hub.emitTranscript(text, final, confidence);
    };
    meter.onLevel = setLevel;
    meter.onError = (e) => setError(`microphone: ${e}`);
  }, [voice, mic, meter, hub]);

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
    if (listening) {
      mic.stop();
    } else {
      mic.start();
      if (voiceOn) voice.speak('Te escucho.');
    }
  };

  const send = async () => {
    const text = typed.trim();
    if (!text) return;
    setError(null);
    try {
      await hub.postAsHuman('user_message', { text, channel: 'ui' }, { to: 'architect' });
      setSent({ text, at: Date.now() });
      setTyped('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const answer = async (permission: { permission_id: string }, decision: 'YES' | 'NO' | 'STOP', raw: string) => {
    try {
      await hub.postAsHuman('user_authorization', { permission_id: permission.permission_id, decision, raw, channel: 'ui' }, { to: 'security', correlation_id: permission.permission_id });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // While the human talks, the mask listens to the camera; otherwise it follows the conversation.
  const humanTalking = listening && (heard !== '' || level > 0.12);
  const lookAt = humanTalking ? 'human' : attentionFor('architect', hub.messages);
  const quiet = hub.faceState === 'IDLE' || hub.faceState === 'COMPLETE' || hub.faceState === 'SUCCESS' || hub.faceState === 'WARNING';
  const faceState = listening && quiet ? 'LISTENING' : hub.faceState;
  const detail = hub.status !== 'open' ? 'no hub connection' : !hub.agentProcessOnline ? 'architect process not connected — run: npm run architect' : hub.faceDetail;

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
        <button className={`btn ${listening ? 'btn--live' : ''}`} onClick={toggleMic} disabled={!mic.isSupported} title="Microphone → stt_transcript. GREEN decides what the words mean.">
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
                <span className="good">✓ enviado a WASP</span> “{sent.text}”
              </p>
            )}
          </section>

          <form
            className="ask"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input className="ask__input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type to WASP (or use the mic)…" />
            <button className="btn" type="submit" disabled={!typed.trim() || hub.status !== 'open'}>
              SEND
            </button>
          </form>
        </div>

        <div className="stage__windows stage__windows--3">
          <TaskWindow context={hub.context} />
          <AgentsWindow context={hub.context} />
          <PermissionsWindow context={hub.context} onAnswer={answer} />
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
