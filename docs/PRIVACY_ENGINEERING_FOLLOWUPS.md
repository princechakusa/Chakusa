# Privacy/Security Engineering Follow-Ups

*Raised 2026-09-01 during the legal-documentation rewrite, from a full backend audit of the marketplace/booking/loyalty/AI modules ("Program 2"). These are product/engineering gaps, not documentation gaps — the Privacy Policy and AI Disclosure can (and now do) describe this behavior honestly, but a policy describing a gap doesn't close it. Tracked here since no issue tracker is connected to this session.*

## 1. Customer-facing AI assistant has no consent/opt-in gate

`src/lib/ai/customerAssistant/customerAssistant.ts` sends every message a customer types to OpenAI or Anthropic. Unlike the business-facing agent (gated behind a `FeatureFlag` the business must enable), this surface is live by default for any authenticated customer — there's no equivalent flag, and no evidence of an explicit consent screen before first use.

**Why it matters:** GDPR/CCPA-style "your data may be sent to a third party" disclosures are weaker protection than an actual opt-in, especially given the assistant handles free-text conversation, not structured form data. A user who never intended to interact with an AI system could end up having their message content sent to an external LLM provider with no prior notice beyond a policy page most people don't read.

**Suggested direction:** add an explicit first-use consent moment (a one-time screen or inline notice: "This assistant uses AI — your messages are sent to \[provider] to generate a response"), gated the same way the business-facing agent already is, before the first message is sent.

## 2. Admins can read raw, unredacted customer AI chat transcripts

`src/modules/admin/aiCustomerAdmin.service.ts`'s `adminCustomerAIConversationDetail` returns full AI conversation content with no redaction, to any admin with the relevant permission.

**Why it matters:** this is the single most sensitive data-access path found in the audit. A customer's AI conversation could reasonably include things a person wouldn't expect a company employee to be able to read verbatim (health questions, personal circumstances, complaints about a specific business). The existing `AdminAuditLog` records that a view happened (per `recordAdminAudit`'s explicit-call pattern), but doesn't limit who can see it or require a reason.

**Suggested direction:** at minimum, ensure every view of this endpoint is unconditionally audit-logged (not just where a call site remembers to), consider whether this should require a justification/reason field logged alongside the view (support-ticket-linked access, not open browsing), and evaluate whether the admin permission for this specific capability should be narrower than general customer-admin access.

## 3. Not verified, worth a follow-up check

- Whether the *original* (non-AI) manual/automated messaging paths (the Pro-plan Twilio send from `messagingService`) check `CustomerOptOut`/`Suppression` before sending, the same way the AI policy engine does. The audit confirmed the AI path checks it; it did not confirm every send path does.
- Whether `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are actually set in the live Render production environment right now — if not, the AI features are wired but dormant, which changes how urgently the above matters.
