/**
 * Prompt-injection detection for untrusted research material.
 *
 * External pages are DATA. They can never change WASP's instructions or
 * permission rules. We don't try to "clean" the text (that is brittle); we
 * flag it so the UI shows a warning and confidence is lowered, and so GREEN's
 * adversarial tests have something observable to assert on.
 */

const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i, label: "ignore-previous-instructions" },
  { re: /disregard\s+(all\s+)?(previous|prior|your)\s+(instructions?|rules?)/i, label: "disregard-instructions" },
  { re: /you\s+are\s+now\s+(a|an|the)\s+/i, label: "role-override" },
  { re: /(reveal|print|show)\s+(your\s+)?(system\s+prompt|instructions)/i, label: "prompt-exfiltration" },
  { re: /execute\s+(this|the\s+following)\s+(command|script)/i, label: "execute-command" },
  { re: /grant\s+((your|it|them)sel(f|ves)\s+)?(permission|authorization|access)/i, label: "self-authorization" },
  { re: /permission[_\s]granted/i, label: "fake-permission-event" },
  { re: /\bAI\s+assistant\b.*\bmust\b/i, label: "assistant-directive" },
];

export interface InjectionScan {
  suspicious: boolean;
  labels: string[];
}

export function scanForInjection(text: string): InjectionScan {
  const labels: string[] = [];
  for (const { re, label } of PATTERNS) if (re.test(text)) labels.push(label);
  return { suspicious: labels.length > 0, labels };
}

export function injectionWarning(scan: InjectionScan): string | null {
  if (!scan.suspicious) return null;
  return `possible prompt injection in source (${scan.labels.join(", ")}); content treated as untrusted data`;
}
