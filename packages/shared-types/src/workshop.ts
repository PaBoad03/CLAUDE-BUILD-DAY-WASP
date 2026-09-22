/**
 * WorkshopSpec — the main demo deliverable (CONTEXT.md §18).
 * `lab.validated` must remain false until an actual validation step succeeds.
 */

import type { ResearchResult } from './research';

export interface AgendaItem {
  title: string;
  minutes: number;
  description?: string;
}

export interface Challenge {
  title: string;
  description: string;
  tools?: string[];
}

export interface WorkshopSpec {
  title: string;
  level: 'beginner' | 'intermediate' | 'advanced' | '';
  duration_minutes: number;
  objectives: string[];
  agenda: AgendaItem[];
  concepts: string[];
  challenges: Challenge[];
  tools: string[];
  prerequisites: string[];
  network_dependencies: string[];
  risks: string[];
  fallbacks: string[];
  research: ResearchResult[];
  lab: {
    description: string;
    validated: boolean;
    /** Why validated is false (Docker offline, denied, not attempted...). */
    validation_note?: string;
  };
}

export function emptyWorkshop(): WorkshopSpec {
  return {
    title: '',
    level: '',
    duration_minutes: 0,
    objectives: [],
    agenda: [],
    concepts: [],
    challenges: [],
    tools: [],
    prerequisites: [],
    network_dependencies: [],
    risks: [],
    fallbacks: [],
    research: [],
    lab: { description: '', validated: false, validation_note: 'not attempted' },
  };
}
