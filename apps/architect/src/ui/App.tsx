import { useEffect, useMemo, useState } from 'react';
import { AgentFace, AgentsWindow, AuditWindow, CommunicationWindow, EventLog, PermissionsWindow, ResearchStatusWindow, SandboxWindow, TaskWindow, WorkshopWindow, agentTheme, useHub } from '@wasp/ui';
import { AGENT_VOICES, VoiceInput, VoiceOutput } from '@wasp/voice';

/**
 * CYAN face — Pablo's PC. The human talks to WASP here:
 *   mic → stt_transcript (final) → the architect process (CliHuman) takes it as the request / answer
 *   typed text → user_message from 'human' through the hub HTTP bridge
 * and hears CYAN's lines (agent_message from architect, speak_requested for architect) through TTS.
 * Everything shown comes from the shared context; this window emits only voice-layer events.
 */
export function App() {
  const theme = agentTheme('architect');
  const hub = useHub('architect');
  const voice = useMemo(() => new VoiceOutput(AGENT_VOICES.architect), []);
  const mic = useMemo(() => new VoiceInput({ lang: navigator.language.startsWith('es') ? 'es-ES' : 'en-US' }), []);
  const [voiceOn, setVoiceOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    voice.onSpeakingChange = setSpeaking;
    voice.onUtterance = (phase, text, ok) => hub.emitTts(phase === 'start' ? 'tts_started' : 'tts_finished', text, ok);
    mic.onListeningChange = setListening;
    mic.onError = (e) => setError(`microphone: ${e}`);
    mic.onTranscript = (text, final, confidence) => {
      setHeard(final ? '' : text);
      if (text) hub.emitTranscript(text, final, confidence);
    };
  }, [voice, mic, hub]);

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
      voice.speak('Cyan architect online.');
    }
  };

  const send = async () => {
    const text = typed.trim();
    if (!text) return;
    setError(null);
    try {
      await hub.postAsHuman('user_message', { text, channel: 'ui' }, { to: 'architect' });
      setTyped('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const detail =
    hub.status !== 'open' ? 'no hub connection' : !hub.agentProcessOnline ? 'architect process not connected — run: npm run architect' : heard ? `hearing: “${heard}”` : hub.faceDetail;

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
        <button className={`btn ${listening ? 'btn--live' : ''}`} onClick={() => mic.toggle()} disabled={!mic.isSupported} title="Microphone → stt_transcript. GREEN decides what the words mean.">
          {mic.isSupported ? (listening ? '● LISTENING' : 'MIC') : 'NO STT'}
        </button>
      </header>
      {error && <p className="degraded">{error}</p>}

      <div className="stage">
        <div className="stage__face">
          <AgentFace color={theme.hex} state={hub.faceState} speaking={speaking} label={theme.name} />
          <p className="stage__detail">{detail}</p>
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
          <PermissionsWindow context={hub.context} />
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
