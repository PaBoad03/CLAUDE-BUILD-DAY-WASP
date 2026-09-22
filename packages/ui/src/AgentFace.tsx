import type { FaceState } from '@wasp/shared-types';

/**
 * Original geometric WASP face. Parameterised by colour and state so every
 * agent (CYAN / MAGENTA / ORANGE / GREEN) renders the same component with its
 * own phosphor. No third-party artwork. States: FaceState from @wasp/shared-types.
 */
export interface AgentFaceProps {
  color: string;
  state: FaceState;
  speaking?: boolean;
  label: string;
}

export function AgentFace({ color, state, speaking = false, label }: AgentFaceProps) {
  const cls = `face face--${state.toLowerCase()}${speaking ? ' face--speaking' : ''}`;
  return (
    <div className={cls} style={{ ['--agent' as string]: color }}>
      <svg viewBox="0 0 320 320" className="face__svg" role="img" aria-label={`${label} face, state ${state}`}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* head frame */}
        <polygon className="face__frame" points="60,40 260,40 290,90 290,230 260,280 60,280 30,230 30,90" />
        <polygon className="face__frame face__frame--inner" points="75,58 245,58 270,98 270,222 245,262 75,262 50,222 50,98" />

        {/* scanning ring (RESEARCHING / ANALYZING / EXECUTING) */}
        <circle className="face__ring" cx="160" cy="150" r="118" />

        {/* eyes */}
        <g className="face__eyes">
          <g className="face__eye face__eye--l" transform="translate(110,130)">
            <polygon className="face__eye-shape" points="0,-22 26,0 0,22 -26,0" />
            <circle className="face__pupil" r="7" />
          </g>
          <g className="face__eye face__eye--r" transform="translate(210,130)">
            <polygon className="face__eye-shape" points="0,-22 26,0 0,22 -26,0" />
            <circle className="face__pupil" r="7" />
          </g>
          {/* ERROR crosses */}
          <g className="face__xeyes">
            <path d="M92 112 L128 148 M128 112 L92 148" />
            <path d="M192 112 L228 148 M228 112 L192 148" />
          </g>
        </g>

        {/* mouth: equaliser bars */}
        <g className="face__mouth" transform="translate(160,215)">
          {[-42, -28, -14, 0, 14, 28, 42].map((x, i) => (
            <rect key={x} className={`face__bar face__bar--${i}`} x={x - 5} y={-6} width="10" height="12" rx="2" />
          ))}
        </g>

        {/* state badges */}
        <g className="face__badge face__badge--complete" transform="translate(160,215)">
          <path d="M-22 0 L-6 16 L24 -18" />
        </g>
        <g className="face__badge face__badge--warning" transform="translate(160,212)">
          <polygon points="0,-20 22,18 -22,18" />
          <line x1="0" y1="-6" x2="0" y2="6" />
          <circle cx="0" cy="12" r="2" />
        </g>
        <g className="face__badge face__badge--lock" transform="translate(160,212)">
          <rect x="-16" y="-4" width="32" height="24" rx="3" />
          <path d="M-9 -4 V-12 A9 9 0 0 1 9 -12 V-4" />
        </g>
      </svg>
      <div className="face__caption">
        <span className="face__label">{label}</span>
        <span className="face__state">{state.replace(/_/g, ' ')}</span>
      </div>
    </div>
  );
}
