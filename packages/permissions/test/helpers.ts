import type { ToolRequest, WaspEvent, WaspEventType } from '@wasp/shared-types';
import { newId } from '@wasp/shared-types';

export const SESSION = 'sess_test';

let clock = 0;
export function fakeNow(): string {
  clock += 1000;
  return new Date(1_800_000_000_000 + clock).toISOString();
}

export function toolRequest(over: Partial<ToolRequest> = {}): ToolRequest {
  return {
    request_id: newId('req'),
    session_id: SESSION,
    agent: 'operator',
    tool: 'docker_sandbox',
    operation: 'create_sandbox',
    input: { image: 'debian:stable-slim', network_access: 'controlled' },
    reason: 'validate the network workshop lab',
    timestamp: fakeNow(),
    ...over,
  };
}

export function event<T extends WaspEventType>(type: T, payload: unknown, source: WaspEvent['source'] = 'operator', session_id = SESSION): WaspEvent<T> {
  return { event_id: newId('evt'), type, session_id, source, timestamp: fakeNow(), payload } as WaspEvent<T>;
}
