import { useEffect, useRef } from 'react';
import type { FaceState } from '@wasp/shared-types';
import { FaceScene, type LookTarget } from './FaceScene';

export interface AgentFace3DProps {
  color: string;
  state: FaceState;
  speaking?: boolean;
  label: string;
  /** Where the mask turns: toward the agent it is talking to, the human (camera) or away. */
  lookAt?: LookTarget;
  detail?: string;
}

/**
 * The 3D WASP face. Same props as the 2D AgentFace plus `lookAt`, so faces can swap freely.
 * Renders a WebGL canvas that fills its container (give the parent a size).
 */
export function AgentFace3D({ color, state, speaking = false, label, lookAt = 'center', detail }: AgentFace3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<FaceScene | null>(null);

  useEffect(() => {
    if (!host.current) return;
    let s: FaceScene | null = null;
    try {
      s = new FaceScene(host.current, color);
    } catch (err) {
      console.error('[AgentFace3D] WebGL unavailable', err);
      return;
    }
    scene.current = s;
    return () => {
      s?.dispose();
      scene.current = null;
    };
  }, [color]);

  useEffect(() => scene.current?.setState(state), [state]);
  useEffect(() => scene.current?.setSpeaking(speaking), [speaking]);
  useEffect(() => scene.current?.setLook(lookAt), [lookAt]);

  return (
    <div className={`face3d face3d--${state.toLowerCase()}`} style={{ ['--agent' as string]: color }}>
      <div ref={host} className="face3d__canvas" aria-label={`${label} face, state ${state}`} role="img" />
      <div className="face3d__caption">
        <span className="face__label">{label}</span>
        <span className="face__state">{state.replace(/_/g, ' ')}</span>
      </div>
      {detail ? <div className="face3d__detail">{detail}</div> : null}
    </div>
  );
}

export type { LookTarget };
