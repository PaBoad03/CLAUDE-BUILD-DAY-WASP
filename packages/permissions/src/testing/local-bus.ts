import type { EventBus, EventHandler, WaspEvent, WaspEventType } from '@wasp/shared-types';

/**
 * Minimal in-process event bus.
 *
 * FOR TESTS AND THE STANDALONE GREEN DEMO ONLY.
 * The real bus lives in the hub (CYAN / Pablo). Agents must receive the hub's
 * EventBus; do not use this in production wiring.
 */
export class LocalEventBus implements EventBus {
  readonly events: WaspEvent[] = [];
  private readonly handlers = new Map<string, Set<EventHandler>>();

  publish(event: WaspEvent): void {
    this.events.push(event);
    const targets = [...(this.handlers.get(event.type) ?? []), ...(this.handlers.get('*') ?? [])];
    for (const h of targets) {
      try {
        void h(event);
      } catch (err) {
        // a failing subscriber must not take down the bus
        console.error('[LocalEventBus] handler error', err);
      }
    }
  }

  subscribe<T extends WaspEventType>(type: T | '*', handler: EventHandler<WaspEvent<T>>): () => void {
    const set = this.handlers.get(type) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.handlers.set(type, set);
    return () => {
      set.delete(handler as EventHandler);
    };
  }

  ofType<T extends WaspEventType>(type: T): WaspEvent<T>[] {
    return this.events.filter((e): e is WaspEvent<T> => e.type === type);
  }

  clear(): void {
    this.events.length = 0;
  }
}

export function createLocalEventBus(): LocalEventBus {
  return new LocalEventBus();
}
