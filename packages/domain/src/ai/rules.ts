// The pure rules of the AI document check, with no database or network import (the evaluation script uses them too).
import type { DocumentCheckResult } from '@kando/contract'

export const DEFAULT_MIN_CONFIDENCE = 0.8
export const DEFAULT_MONTHLY_CAP_EUR = 20

/** English name of each document type, as the model is told it. */
export const TYPE_NAME: Record<string, string> = {
  'id-document': 'photo ID (identity card, passport or driving licence)',
  'trade-registration': 'trade registration (Gewerbeanmeldung)',
  'liability-insurance': 'liability insurance certificate',
  'police-certificate': 'police clearance certificate (Führungszeugnis)',
  'hygiene-certificate': 'hygiene certificate',
  'food-business-registration': 'food business registration',
  permit: 'official permit',
  'craft-qualification': 'craft qualification certificate',
  'first-aid-certificate': 'first aid certificate',
}
/** A number from the environment inside [min, max], else the default (an unset, empty or bad value never switches a limit off). */
function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}
export const minConfidence = () => envNumber('AI_MIN_CONFIDENCE', DEFAULT_MIN_CONFIDENCE, 0, 1)
export const monthlyCapEur = () => envNumber('AI_MONTHLY_CAP_EUR', DEFAULT_MONTHLY_CAP_EUR, 0, 100_000)

/**
 * Defensive clean-up of the "why not approved" text before it is stored: dates and long digit runs (ID, document and phone numbers,
 * also written with spaces or dashes) are replaced, the length is capped. The prompt already forbids them; this is the second wall.
 */
export function stripPersonalData(text: string): string {
  return text
    .replace(/\b\d{1,2}[./-]\s?\d{1,2}[./-]\s?\d{2,4}\b/g, '[date]')
    .replace(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g, '[date]')
    .replace(/\b\d{1,2}\.?\s+(?:[A-Za-zÄÖÜäöüß]{3,12})\.?\s+\d{2,4}\b/g, '[date]')
    .replace(/\d(?:[\s.\-/]?\d){5,}/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** The rule: auto-approve only when the AI found no problem and is sure enough. (The random spot check comes after, and can reverse it.) */
export const wouldAutoApprove = (r: DocumentCheckResult, min: number) =>
  r.verdict === 'ok' && r.confidence >= min && r.documentTypeMatches && r.nameMatches && r.notExpired !== false

