import { useEffect, useMemo, useState } from 'react';
import { AgentFace3D, AuditWindow, CommunicationWindow, EventLog, SandboxWindow, TerminalWindow, agentTheme, attentionFor, useHub } from '@wasp/ui';
import { AGENT_VOICES, VoiceOutput } from '@wasp/voice';

/** ORANGE face — Felipe's PC. Viewer of the shared stream; speaks ORANGE's own lines. */
export function App() {
  const theme = agentTheme('operator');
  const hub = useHub('operator');
  const voice = useMemo(() => new VoiceOutput(AGENT_VOICES.operator), []);
  const [voiceOn, setVoiceOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    voice.onSpeakingChange = setSpeaking;
    voice.onUtterance = (phase, text, ok) => hub.emitTts(phase === 'start' ? 'tts_started' : 'tts_finished', text, ok);
  }, [voice, hub]);
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
      voice.speak('Orange operator online.');
    }
  };

  const me = hub.context?.agents.operator;
  const detail =
    hub.status !== 'open' ? 'no hub connection' : !hub.agentProcessOnline ? 'operator process not connected — run: npm run operator' : me?.mode === 'stub' ? 'STUB — fake Docker, nothing real runs' : hub.faceDetail;

  return (
    <main className={`screen ${theme.className}`}>
      <div className="crt" aria-hidden="true" />
      <header className="topbar">
        <span className="topbar__brand">WASP</span>
        <span className="topbar__agent">{theme.label}</span>
        <span className={`topbar__conn topbar__conn--${hub.status}`}>HUB {hub.status.toUpperCase()}</span>
        <span className={`topbar__conn topbar__conn--${hub.agentProcessOnline ? 'open' : 'closed'}`}>AGENT {hub.agentProcessOnline ? (me?.mode === 'stub' ? 'STUB' : 'ONLINE') : 'OFFLINE'}</span>
        <span className="topbar__session">{hub.sessionId || 'no session'}</span>
        <button className="btn" onClick={toggleVoice} disabled={!voice.isSupported}>
          {voice.isSupported ? (voiceOn ? 'VOICE ON' : 'ENABLE VOICE') : 'NO TTS'}
        </button>
      </header>

      <div className="stage">
        <div className="stage__face">
          <AgentFace3D color={theme.hex} state={hub.faceState} speaking={speaking} label={theme.name} lookAt={attentionFor('operator', hub.messages)} detail={detail} />
        </div>
        <div className="stage__windows">
          <SandboxWindow context={hub.context} />
          <TerminalWindow events={hub.events} />
          <CommunicationWindow messages={hub.messages} rows={4} />
          <AuditWindow context={hub.context} rows={5} />
          <EventLog events={hub.events} rows={8} />
        </div>
      </div>
    </main>
  );
}
