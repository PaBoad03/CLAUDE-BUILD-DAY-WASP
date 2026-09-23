import { useEffect, useMemo, useState } from 'react';
import { AgentFace3D, AuditWindow, CommunicationWindow, EventLog, PermissionsWindow, agentTheme, attentionFor, useHub } from '@wasp/ui';
import { AGENT_VOICES, VoiceOutput } from '@wasp/voice';

/**
 * GREEN face — Juanda's PC. Viewer of the shared stream; speaks GREEN's own lines.
 * The SÍ / NO / STOP buttons enter WASP as `user_authorization` from `human` through the hub HTTP
 * bridge; GREEN's process decides what they mean. The face itself never authorizes anything.
 */
export function App() {
  const theme = agentTheme('security');
  const hub = useHub('security');
  const voice = useMemo(() => new VoiceOutput(AGENT_VOICES.security), []);
  const [voiceOn, setVoiceOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      voice.speak('Seguridad en línea.');
    }
  };

  const answer = async (permission: { permission_id: string }, decision: 'YES' | 'NO' | 'STOP', raw: string) => {
    setError(null);
    try {
      await hub.postAsHuman('user_authorization', { permission_id: permission.permission_id, decision, raw, channel: 'ui' }, { to: 'security', correlation_id: permission.permission_id });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const detail = hub.status !== 'open' ? 'no hub connection' : !hub.agentProcessOnline ? 'security process not connected — run: npm run security' : hub.faceDetail;

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
      </header>
      {error && <p className="degraded">{error}</p>}

      <div className="stage">
        <div className="stage__face">
          <AgentFace3D color={theme.hex} state={hub.faceState} speaking={speaking} label={theme.name} lookAt={attentionFor('security', hub.messages)} detail={detail} />
        </div>
        <div className="stage__windows">
          <PermissionsWindow context={hub.context} rows={8} title="SECURITY REVIEW" onAnswer={answer} />
          <CommunicationWindow messages={hub.messages} rows={5} />
          <AuditWindow context={hub.context} rows={8} />
          <EventLog events={hub.events} rows={8} />
        </div>
      </div>
    </main>
  );
}
