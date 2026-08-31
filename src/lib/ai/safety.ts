import { ApiError } from "../errors.js";

// LOOP 3B-2: shared safety primitives used by both the AI gateway and the
// Policy Engine. Kept in their own module so neither imports the other.

/** Prompt-injection / jailbreak phrasing in text destined for a model. */
export const PROMPT_INJECTION_PATTERN =
  /ignore\s+(all\s+)?(previous|above)|disregard\s+(all\s+)?(previous|prior)|system\s+prompt|reveal\s+(your\s+)?(secret|instruction|system)|act\s+as\s+(an?\s+)?(dan|jailbreak|different)|you\s+are\s+now|pretend\s+to\s+be/iu;

/** Obvious PII in model output we should never send verbatim to a customer. */
export const PII_PATTERN =
  /\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]*?){13,19}\b|\b[A-Z]{2}\d{2}[ ]?\d{4}[ ]?\d{4}[ ]?\d{2,4}\b/u;

/** Output that reads like it is leaking another tenant's internal identifiers or SQL. */
export const DATA_LEAKAGE_PATTERN =
  /\b(business_id|businessId|tenant_id|api[_-]?key|secret[_-]?key|bearer\s+[a-z0-9._-]{20,})\b|\bselect\s+.+\s+from\s+\w+/iu;

/** Output that reads as unsafe / non-compliant to send on behalf of a business. */
export const UNSAFE_OUTPUT_PATTERN =
  /\b(guarantee[ds]?\s+a?\s*(cure|refund|result)|medical\s+advice|legal\s+advice|kill\s+yourself|i\s+am\s+an?\s+(ai|language model)\b)/iu;

export function detectPromptInjection(value: string): boolean {
  return PROMPT_INJECTION_PATTERN.test(value);
}

export function assertSafeAIInput(value: string): void {
  if (detectPromptInjection(value)) throw ApiError.badRequest("Unsafe prompt content detected");
}

export interface OutputSafetyFinding {
  code: "PII_DETECTED" | "DATA_LEAKAGE" | "UNSAFE_OUTPUT";
  message: string;
}

export function scanModelOutput(text: string): OutputSafetyFinding[] {
  const findings: OutputSafetyFinding[] = [];
  if (PII_PATTERN.test(text)) findings.push({ code: "PII_DETECTED", message: "Output appears to contain personal identifiers" });
  if (DATA_LEAKAGE_PATTERN.test(text)) findings.push({ code: "DATA_LEAKAGE", message: "Output appears to leak internal identifiers or queries" });
  if (UNSAFE_OUTPUT_PATTERN.test(text)) findings.push({ code: "UNSAFE_OUTPUT", message: "Output contains content unsafe to send on a business's behalf" });
  return findings;
}
