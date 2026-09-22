export * from './agents';
export * from './audit';
export * from './context';
export * from './events';
export * from './permissions';
export * from './research';
export * from './tools';
export * from './workshop';

/** Default hub port. Override with WASP_HUB_PORT / WASP_HUB_URL. */
export const DEFAULT_HUB_PORT = 7331;

/** Tiny id helper so nobody pulls in uuid just for this. */
export function newId(prefix = 'evt'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
