import { useEffect, useMemo, useState } from "react";
import { AGENTS } from "@wasp/shared-types";
import { AgentFace } from "./components/AgentFace";
import { EventLog } from "./components/EventLog";
import { CommunicationWindow, SourcesWindow, VerificationWindow } from "./components/ResearchWindows";
import { useHub } from "./hooks/useHub";
import { VoiceOutput } from "./voice/tts";

const DEMO_QUESTION = "beginner-friendly network reconnaissance workshop: safe exercises (ping, DNS, interfaces, routes) for a two-hour session";

export function App() {
  const hub = useHub();
  const voice = useMemo(() => new VoiceOutput({ lang: "en-US", pitch: 1.15 }), []);
  const [voiceOn, setVoiceOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  // Voice layer: report tts_started / tts_finished to the bus (docs/CONTRACT.md §4).
  useEffect(() => {
    voice.onSpeakingChange = setSpeaking;
    voice.onUtterance = (phase, text, ok) => hub.emitTts(phase === "start" ? "tts_started" : "tts_finished", text, ok);
  }, [voice, hub]);

  // Voice consumes the event stream: only MAGENTA's own lines.
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
      voice.speak("Magenta researcher online.");
    }
  };

  const simulate = () => {
    setDevError(null);
    hub.simulateArchitectRequest(DEMO_QUESTION).catch((e: Error) => setDevError(e.message));
  };

  const detail =
    hub.status !== "open" ? "no hub connection" : !hub.agentProcessOnline ? "agent process not connected — run: npm run agent -w @wasp/researcher" : hub.faceDetail;

  // M1: the dev button only makes sense when the real CYAN is not driving (or behind ?dev=1).
  const showSimulate = !hub.architectOnline || new URLSearchParams(location.search).get("dev") === "1";

  return (
    <main className="screen theme-magenta">
      <div className="crt" aria-hidden="true" />
      <header className="topbar">
        <span className="topbar__brand">WASP</span>
        <span className="topbar__agent">MAGENTA · RESEARCHER</span>
        <span className={`topbar__conn topbar__conn--${hub.status}`}>HUB {hub.status.toUpperCase()}</span>
        <span className={`topbar__conn topbar__conn--${hub.agentProcessOnline ? "open" : "closed"}`}>AGENT {hub.agentProcessOnline ? "ONLINE" : "OFFLINE"}</span>
        <span className="topbar__session">{hub.sessionId || "no session"}</span>
        <button className="btn" onClick={toggleVoice} disabled={!voice.isSupported}>
          {voice.isSupported ? (voiceOn ? "VOICE ON" : "ENABLE VOICE") : "NO TTS"}
        </button>
        {showSimulate && (
          <button className="btn btn--ghost" onClick={simulate} title="DEV ONLY: inject a CYAN research_request through the hub HTTP API (hidden while the real CYAN is online)">
            SIMULATE CYAN REQUEST
          </button>
        )}
      </header>
      {devError && <p className="degraded">dev button failed: {devError}</p>}

      <div className="stage">
        <div className="stage__face">
          <AgentFace color={AGENTS.researcher.hex} state={hub.faceState} speaking={speaking} label="MAGENTA" />
          <p className="stage__detail">{detail}</p>
        </div>

        <div className="stage__windows">
          <SourcesWindow research={hub.research} state={hub.faceState} />
          <VerificationWindow research={hub.research} />
          <CommunicationWindow messages={hub.messages} />
          <EventLog events={hub.events} />
        </div>
      </div>
    </main>
  );
}
