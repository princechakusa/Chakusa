# OWNER DECISION — OA-6 / #22 Desktop-Web Business Experience

**Status:** APPROVED — Claude should proceed autonomously.

This document resolves the owner-decision gate raised after stages #18–#21.

## Decision

Use the existing `website/` Astro application as the Chakusa **business desktop/web experience**.

Do **not** use or expose `admin/` to businesses. `admin/` remains the platform-administration console.

Do **not** create a third web application or a second backend/business-logic stack.

The existing partially scaffolded Astro dashboard is the foundation. Inspect it, preserve working pieces, and complete it incrementally.

## Architecture

1. `website/` is the business-facing desktop/web client.
2. Existing Fastify/backend domain services and authorization remain authoritative.
3. `cloudflare/auth-gateway` remains the web authentication/API boundary where that is the current architecture.
4. Expand the gateway only for the business API surfaces actually required by #22. Prefer a maintainable authenticated `/v1/*` forwarding architecture over thirteen unrelated copy-pasted proxy implementations, but do not create a dangerous unrestricted generic proxy.
5. Every forwarded business route must preserve server-side authentication, tenant resolution, capability authorization, entitlement checks, request validation, rate/security controls and safe error handling.
6. Never reproduce authorization or financial/business truth in Astro/client code.
7. Never expose platform-admin APIs, internal-only endpoints, secrets, provider credentials, unrestricted database access or cross-tenant resources through the gateway.
8. Reuse existing backend APIs. If a small backend API gap prevents a legitimate web workflow, extend the existing domain module rather than creating web-only business logic.

## V1 scope

Build operational parity for the high-value business workflows in this order, adapting to the repository if some pages are already functional:

1. Dashboard / attention summary
2. Calendar and appointments
3. Leads
4. Customers
5. Unified inbox/messages
6. Quotes and estimates
7. Invoices and customer payments
8. Team / schedules / commissions where role permits
9. Inventory
10. Reviews / reputation
11. AI Receptionist / after-hours settings
12. Business settings / service catalogue / availability as required for normal operation
13. Reports/financial summaries already supported safely by backend APIs

Do not delay #22 for low-value mobile-only polish or post-V1 features.

## Roles and capabilities

Web must honor the same OWNER / ADMIN / STAFF capability matrix as mobile/backend.

UI should hide/disable unavailable actions for usability, but backend/gateway authorization is authoritative.

Explicitly test STAFF against owner/admin-only surfaces and ADMIN against OWNER-only surfaces.

## UX requirements

- Desktop-first but responsive down to practical tablet/smaller browser widths.
- Keyboard-accessible navigation and forms.
- Semantic HTML, labels, focus states, sensible heading order and accessible dialogs/errors.
- Loading, empty, error and permission-denied states.
- No giant page components; extract reusable layout, table/list, form, dialog and API utilities where justified.
- Preserve Chakusa visual identity; do not redesign the whole product merely because pages are stubs.

## Session/security requirements

Inspect the existing web authentication model before changing it.

Required properties:
- secure session handling
- no business/customer session confusion
- CSRF protection where cookie-authenticated mutations require it
- no tokens/secrets in logs or rendered HTML
- safe logout/session expiry
- tenant isolation
- capability and entitlement enforcement
- no open proxy behavior in auth-gateway
- strict destination allowlisting if gateway routing is generalized
- validation of methods/paths/headers/body forwarding

## Verification strategy

Claude is authorized to choose the safest test tooling compatible with the existing Astro repository. Do not stop merely to ask whether to use Playwright/Vitest/etc.; inspect dependencies and select the smallest maintainable strategy.

At minimum verify:
- build/typecheck
- unit/component tests where appropriate
- gateway auth/route security tests
- role/capability behavior
- tenant isolation
- core desktop workflows
- responsive layout sanity
- accessibility basics
- regression of existing website/public pages

If Playwright or an equivalent browser E2E tool is already present, reuse it. If not, adding a conventional dev-only test dependency is an ordinary reversible engineering decision and does not require owner approval.

## Completion gate

#22 is complete only when the high-value business workflows above are genuinely usable from the web, not merely represented by navigation links or stub pages.

Return a report covering:
1. architecture reused
2. gateway design and security
3. pages/workflows completed
4. API gaps added
5. capability/entitlement behavior
6. session/auth security
7. responsive/accessibility work
8. tests and browser verification
9. regressions
10. files/commits
11. limitations deferred to post-V1

Then continue autonomously to #23.

## No-stop instruction

The approach, V1 scope and verification strategy are now owner-approved. Do not stop again for ordinary #22 implementation choices. Stop only for the genuine external/irreversible conditions defined by `CLAUDE.md` and the master roadmap.

## Independent work while external actions remain open

OA-1 production migration deployment and OA-5 app-link identifiers remain external owner/deployment actions. They must be tracked, but they do not block implementation of #22 or subsequent stages that can be completed safely without them.
