import { z } from "zod";

// PROGRAM 3 LOOP 3E: body for POST /public/quotes/:token/accept and
// /decline. Deliberately minimal - the acceptance/decline signal is the
// authenticated bearer token plus the HTTP action itself. An optional
// free-text note is passed through to the QuoteEvent ledger for the
// business's benefit (e.g. a decline reason). NO typed-name capture, NO
// signature, NO "I agree" consent representation - that is a product /
// legal decision the repository does not encode (see the Loop 3E report's
// legal-gap note).
export const publicQuoteDecisionSchema = z.object({
  note: z
    .string()
    .trim()
    .max(2000, "Note must be 2000 characters or fewer")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type PublicQuoteDecisionInput = z.infer<typeof publicQuoteDecisionSchema>;
