/**
 * Turn a document-requirements email pasted by a bank into structured requirement rows.
 *
 * Ported from Project Harmony's `parseEmailRequirements` (`src/lib/documents-types.ts`),
 * adapted to this repo's conventions: a stable UPPER_SNAKE `code` (matching
 * `BankFileItem.code`'s own convention, e.g. `NATIONAL_ID`) instead of a lowercase
 * `type`, and no `id`/`sortOrder` bookkeeping here — that belongs to the Prisma layer in
 * `LenderRequirementsService`, which is the only thing that knows what already exists for
 * a given bank.
 *
 * A pure function on purpose, same reasoning as `lender-access.ts` and `loan-terms.ts`:
 * this carries a real product decision (which lines in an email are a requirement versus
 * a greeting) and needs to be readable and testable on its own, away from Prisma.
 */

export interface ParsedRequirement {
  code: string;
  label: string;
  guidance: string;
  required: boolean;
}

/** Lines that are email furniture rather than requirements. */
const NOISE = [
  /^(from|to|cc|bcc|sent|date|subject|re|fwd)\s*:/i,
  /^(dear|hello|hi|good (morning|afternoon|evening))\b/i,
  /^(kind |best |warm )?regards\b/i,
  /^(thank you|thanks|many thanks|sincerely|yours\b)/i,
  /^(please find|kindly find|as discussed|further to|following our)\b/i,
  /^(tel|mobile|phone|email|e-mail|fax|website|www\.|http)/i,
  /^-{2,}|^_{2,}|^={2,}/,
  /^(on .+ wrote:)$/i,
  /^(this (e-?mail|message) .*(confidential|intended))/i,
  /^(p\.?o\.? box|kigali|rwanda)\b/i,
];

/** Everything after a sign-off is signature, not requirements. */
const SIGN_OFF =
  /^((kind |best |warm )?regards|thank you|thanks|many thanks|sincerely|yours\b|cordialement|murakoze)/i;

const OPTIONAL_HINT =
  /\b(optional|if available|if any|where applicable|if applicable|not mandatory|nice to have|si disponible)\b/i;
const MANDATORY_HINT =
  /\b(mandatory|compulsory|required|must (be )?(provide|submit|attach))\b/i;
const INTRO_HINT =
  /\b(documents?|requirements?|checklist|attach|submit|provide|following|below)\b.*:\s*$/i;

/**
 * Handles bullets, numbering, "Label: guidance", "Label - guidance", and the
 * (optional)/(mandatory) wording banks normally write. Greetings, signatures and quoted
 * headers are dropped. Caps at 40 lines, same limit Project Harmony used — a paste this
 * long is almost certainly the wrong text.
 */
export function parseEmailRequirements(text: string): ParsedRequirement[] {
  const raw = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*>+\s*/, '').trim())
    .filter(Boolean);

  const signOffAt = raw.findIndex((l) => SIGN_OFF.test(l));
  const lines = (signOffAt >= 0 ? raw.slice(0, signOffAt) : raw)
    .filter((l) => !NOISE.some((re) => re.test(l)))
    .filter((l) => !INTRO_HINT.test(l));

  // A single dense paragraph: split on bullets, semicolons or numbering.
  const candidates =
    lines.length <= 1 && lines[0]
      ? lines[0]
          .split(/\s*(?:•|·|;)\s*|\s+\d+[.)]\s+/)
          .map((p) => p.trim())
          .filter(Boolean)
      : lines;

  const seen = new Set<string>();
  const out: ParsedRequirement[] = [];

  for (const candidate of candidates) {
    const line = candidate
      .replace(/^\s*(?:[-*•·–—]|\(?\d+[.)]|[a-z][.)])\s*/i, '')
      .trim();
    if (line.length < 3) continue;
    // Skip prose that is clearly a sentence, not a document name.
    if (line.split(/\s+/).length > 22) continue;

    let label = line;
    let guidance = '';

    if (line.includes('|')) {
      const [l = '', h = '', flag = ''] = line.split('|').map((p) => p.trim());
      label = l;
      guidance = h;
      if (flag) label = `${label} (${flag})`;
    } else {
      const split = line.match(/^(.{3,80}?)\s*(?:[:—–]|\s-\s)\s*(.+)$/);
      if (split) {
        label = split[1].trim();
        guidance = split[2].trim();
      }
    }

    const scope = `${label} ${guidance}`;
    const optional = OPTIONAL_HINT.test(scope) && !MANDATORY_HINT.test(label);

    label = label
      .replace(
        /\((optional|if available|if any|mandatory|compulsory|required)[^)]*\)/gi,
        '',
      )
      .replace(/[,–—-]\s*(optional|mandatory|compulsory|required)\s*$/i, '')
      .replace(
        /[,;]?\s*\b(if available|if any|where applicable|if applicable|optional)\b\s*$/i,
        '',
      )
      .replace(/\s{2,}/g, ' ')
      .replace(/[.;:,]+$/, '')
      .trim();
    guidance = guidance
      .replace(/\s{2,}/g, ' ')
      .replace(/^[.;:,]+/, '')
      .trim();

    if (label.length < 3) continue;

    const code = slugifyToCode(label) || `REQUIREMENT_${out.length + 1}`;
    if (seen.has(code)) continue;
    seen.add(code);

    out.push({
      code,
      label: label.slice(0, 120),
      guidance: guidance.slice(0, 400),
      required: !optional,
    });

    if (out.length >= 40) break;
  }

  return out;
}

/** `"10% deposit proof"` becomes a stable, uppercase-snake code like `DEPOSIT_PROOF`. */
export function slugifyToCode(label: string): string {
  return label
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}
