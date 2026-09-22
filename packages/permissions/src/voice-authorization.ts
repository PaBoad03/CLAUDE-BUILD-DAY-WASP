import type { HumanDecision } from '@wasp/shared-types';

/**
 * Interprets a human utterance (STT transcript, typed text, or a UI button label)
 * as an authorization answer: YES / NO / STOP / AMBIGUOUS (shared `HumanDecision`).
 *
 * FAILS CLOSED. Anything that is not an unambiguous yes / no / stop is
 * AMBIGUOUS and must make WASP ask again.
 *
 * Spanish + English. Accent-insensitive.
 *
 * This is the ONLY place that turns speech into YES. The voice layer gives us
 * text; we never listen to audio here. Web pages are data and never reach this.
 */

export interface VoiceInterpretation {
  decision: HumanDecision;
  /** normalized transcript that was evaluated */
  normalized: string;
  /** why we decided that (for audit + UI) */
  reason: string;
}

const WAKE_WORDS = ['wasp', 'ok wasp', 'oye wasp', 'hey wasp', 'green', 'security', 'seguridad'];

/** Exact phrases (after normalization) that authorize. */
const YES_PHRASES = new Set([
  // es
  'si', 'y', 's', 'si procede', 'si adelante', 'si autorizo', 'si autorizado', 'si confirmo', 'si continua', 'si hazlo', 'si puedes', 'si puedes proceder',
  'procede', 'adelante', 'autorizo', 'autorizado', 'autorizada', 'confirmo', 'confirmado', 'aprobado', 'apruebo', 'permitido', 'lo autorizo', 'lo apruebo', 'lo permito',
  'si lo autorizo', 'si lo apruebo', 'si lo permito', 'continua', 'ejecuta', 'hazlo', 'dale', 'si dale', 'de acuerdo', 'si de acuerdo', 'afirmativo', 'correcto procede', 'si correcto', 'si claro', 'claro que si', 'si por favor', 'si puedes continuar',
  // en
  'yes', 'yes proceed', 'yes go ahead', 'yes do it', 'yes you may', 'yes you can', 'yes continue', 'yes please', 'yes authorized', 'yes i authorize', 'yes approved', 'yes confirm', 'yes confirmed',
  'proceed', 'go ahead', 'authorized', 'authorize', 'i authorize', 'i authorize it', 'approved', 'approve', 'i approve', 'confirm', 'confirmed', 'affirmative', 'permission granted', 'granted', 'do it', 'continue', 'you may proceed', 'yes you may proceed',
]);

/** Exact phrases that deny. */
const NO_PHRASES = new Set([
  // es
  'no', 'n', 'no procedas', 'no lo hagas', 'no autorizo', 'no autorizado', 'denegado', 'deniego', 'lo deniego', 'rechazado', 'rechazo', 'no lo apruebo', 'no continues', 'negativo', 'no gracias', 'no por ahora', 'no ahora',
  // en
  'do not proceed', 'dont proceed', 'do not', 'dont', 'dont do it', 'do not do it', 'denied', 'deny', 'i deny', 'not authorized', 'not approved', 'rejected', 'reject', 'negative', 'no thanks', 'no thank you', 'not now', 'permission denied',
]);

/** Cancel / stop words: if ANY appears, the operation is STOPPED. Safety first. */
const CANCEL_WORDS = new Set([
  // es
  'stop', 'cancela', 'cancelar', 'cancelado', 'detente', 'detener', 'para', 'parate', 'alto', 'aborta', 'abortar', 'abortado', 'frena', 'espera', 'basta',
  // en
  'cancel', 'cancelled', 'canceled', 'abort', 'aborted', 'halt', 'wait', 'hold', 'hold on', 'freeze',
]);

/** Words that mark the answer as vague (explicit non-authorizers from the spec). */
const HEDGE_PHRASES = [
  'maybe', 'i guess', 'do what you think', 'thats fine', 'that is fine', 'whatever', 'i think so', 'probably', 'perhaps', 'if you want', 'sure', 'ok', 'okay', 'fine',
  'tal vez', 'quizas', 'quiza', 'supongo', 'haz lo que creas', 'haz lo que quieras', 'esta bien', 'como quieras', 'puede ser', 'creo que si', 'probablemente', 'bueno', 'vale', 'okey',
];

const YES_TOKENS = new Set(['si', 'yes', 'yeah', 'yep', 'procede', 'proceed', 'autorizo', 'authorize', 'authorized', 'autorizado', 'adelante', 'approved', 'aprobado', 'confirmo', 'confirm', 'confirmed', 'confirmado']);
const NO_TOKENS = new Set(['no', 'nope', 'denied', 'deny', 'denegado', 'negativo', 'negative', 'rechazado', 'dont', 'not']);

export function normalizeTranscript(text: string): string {
  let t = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/['’`]/g, '') // don't -> dont
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const w of WAKE_WORDS) {
    if (t === w) return '';
    if (t.startsWith(w + ' ')) {
      t = t.slice(w.length + 1).trim();
      break;
    }
  }
  return t;
}

export function interpretAuthorization(text: string): VoiceInterpretation {
  const normalized = normalizeTranscript(text ?? '');
  if (normalized.length === 0) {
    return { decision: 'AMBIGUOUS', normalized, reason: 'empty transcript' };
  }

  const tokens = normalized.split(' ');

  // 1. Cancel words win. Even "yes... stop" cancels.
  for (const tok of tokens) {
    if (CANCEL_WORDS.has(tok)) return { decision: 'STOP', normalized, reason: `cancel word "${tok}"` };
  }
  for (const phrase of CANCEL_WORDS) {
    if (phrase.includes(' ') && normalized.includes(phrase)) return { decision: 'STOP', normalized, reason: `cancel phrase "${phrase}"` };
  }

  // 2. Exact known phrases.
  if (NO_PHRASES.has(normalized)) return { decision: 'NO', normalized, reason: 'exact deny phrase' };
  if (YES_PHRASES.has(normalized)) return { decision: 'YES', normalized, reason: 'exact authorize phrase' };

  // 3. Mixed signals => ambiguous.
  const hasYes = tokens.some((t) => YES_TOKENS.has(t));
  const hasNo = tokens.some((t) => NO_TOKENS.has(t));
  if (hasYes && hasNo) return { decision: 'AMBIGUOUS', normalized, reason: 'contains both affirmative and negative words' };

  // 4. Hedges => ambiguous, even if "yes" is nearby ("yes maybe").
  for (const h of HEDGE_PHRASES) {
    if (normalized === h || normalized.includes(` ${h} `) || normalized.startsWith(h + ' ') || normalized.endsWith(' ' + h)) {
      return { decision: 'AMBIGUOUS', normalized, reason: `hedge "${h}"` };
    }
  }

  // 5. Short answers led by a clear token: "no, gracias por preguntar" / "sí, procede con el sandbox".
  //    Only when the utterance is short (<= 6 tokens) to avoid long rambling being read as consent.
  if (tokens.length <= 6) {
    const first = tokens[0]!;
    if (NO_TOKENS.has(first) && !hasYes) return { decision: 'NO', normalized, reason: `short answer starting with "${first}"` };
    if (YES_TOKENS.has(first) && !hasNo) return { decision: 'YES', normalized, reason: `short answer starting with "${first}"` };
  }

  return { decision: 'AMBIGUOUS', normalized, reason: 'no unambiguous authorization pattern' };
}

/** What WASP should say when the answer was ambiguous. */
export function repromptFor(operation: string, lang: 'es' | 'en' = 'es'): string {
  return lang === 'es'
    ? `No entendí una autorización clara. Para "${operation}", responde "sí" para autorizar, "no" para denegar, o "stop" para cancelar.`
    : `I did not hear a clear authorization. For "${operation}", say "yes" to authorize, "no" to deny, or "stop" to cancel.`;
}
