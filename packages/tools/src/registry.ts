import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { RiskLevel, ToolDefinition } from '@wasp/shared-types';

export interface ArgSpec {
  type: 'string' | 'integer';
  required?: boolean;
  allowed?: Array<string | number>;
  min?: number;
  max?: number;
  default?: string | number;
}

export interface ToolSpec {
  name: string;
  description: string;
  risk: RiskLevel;
  requires_approval: boolean;
  args: Record<string, ArgSpec>;
}

export interface RegistryFile {
  version: number;
  owner: string;
  risk_levels: RiskLevel[];
  tools: ToolSpec[];
}

export type ArgValidation =
  | { ok: true; args: Record<string, string | number> }
  | { ok: false; errors: string[] };

const DEFAULT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../schemas/tools.json');

/**
 * Tool registry backed by schemas/tools.json.
 * This is the *only* place argument allowlists live. If an arg is not
 * declared here, it is rejected — the model cannot smuggle extra flags.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();

  constructor(file: RegistryFile) {
    for (const t of file.tools) {
      if (this.tools.has(t.name)) throw new Error(`duplicate tool ${t.name}`);
      if (!file.risk_levels.includes(t.risk)) throw new Error(`tool ${t.name}: unknown risk ${t.risk}`);
      this.tools.set(t.name, t);
    }
  }

  static load(path: string = DEFAULT_PATH): ToolRegistry {
    return new ToolRegistry(JSON.parse(readFileSync(path, 'utf8')) as RegistryFile);
  }

  static fromSpecs(tools: ToolSpec[]): ToolRegistry {
    return new ToolRegistry({ version: 0, owner: 'test', risk_levels: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], tools });
  }

  list(): ToolSpec[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * The registry as the shared-contract `ToolDefinition[]` (emitted as `tools_registered`).
   * `available` reflects whether Docker is reachable right now; GREEN reads risk/requires_approval from here.
   */
  toToolDefinitions(opts: { available: boolean; unavailable_reason?: string }): ToolDefinition[] {
    return this.list().map((t) => ({
      id: t.name,
      description: t.description,
      owner: 'operator',
      risk: t.risk,
      requires_approval: t.requires_approval,
      input_schema: toJsonSchema(t.args),
      available: opts.available,
      unavailable_reason: opts.available ? undefined : opts.unavailable_reason ?? 'Docker unavailable',
    }));
  }

  /** Validate and normalise args. Unknown keys are errors, not ignored. */
  validate(name: string, raw: Record<string, unknown>): ArgValidation {
    const spec = this.tools.get(name);
    if (!spec) return { ok: false, errors: [`unknown tool "${name}"`] };

    const errors: string[] = [];
    const out: Record<string, string | number> = {};

    for (const key of Object.keys(raw ?? {})) {
      if (!(key in spec.args)) errors.push(`unexpected argument "${key}"`);
    }

    for (const [key, a] of Object.entries(spec.args)) {
      let v = raw?.[key];
      if (v === undefined || v === null) {
        if (a.default !== undefined) v = a.default;
        else if (a.required) {
          errors.push(`missing required argument "${key}"`);
          continue;
        } else continue;
      }

      if (a.type === 'integer') {
        if (typeof v === 'string' && /^\d+$/.test(v)) v = Number(v);
        if (typeof v !== 'number' || !Number.isInteger(v)) {
          errors.push(`"${key}" must be an integer`);
          continue;
        }
        if (a.min !== undefined && v < a.min) errors.push(`"${key}" below minimum ${a.min}`);
        if (a.max !== undefined && v > a.max) errors.push(`"${key}" above maximum ${a.max}`);
      } else {
        if (typeof v !== 'string') {
          errors.push(`"${key}" must be a string`);
          continue;
        }
        // Defensive: even allowlisted values are checked for shell-ish noise.
        if (!/^[A-Za-z0-9.:/_-]+$/.test(v)) {
          errors.push(`"${key}" contains disallowed characters`);
          continue;
        }
      }

      if (a.allowed && !a.allowed.includes(v as string | number)) {
        errors.push(`"${key}" = ${JSON.stringify(v)} is not in the allowlist`);
        continue;
      }
      out[key] = v as string | number;
    }

    return errors.length ? { ok: false, errors } : { ok: true, args: out };
  }
}

/** ArgSpec map → JSON Schema (also usable as a Claude tool input_schema). */
export function toJsonSchema(args: Record<string, ArgSpec>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, a] of Object.entries(args)) {
    const p: Record<string, unknown> = { type: a.type === 'integer' ? 'integer' : 'string' };
    if (a.allowed) p.enum = a.allowed;
    if (a.min !== undefined) p.minimum = a.min;
    if (a.max !== undefined) p.maximum = a.max;
    if (a.default !== undefined) p.default = a.default;
    properties[k] = p;
    if (a.required) required.push(k);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}
