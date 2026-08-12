# Chakusa Engineering Spec

Backend source of truth for the Chakusa API. Consumed by the Codex-built mobile app.

## 1. Architecture

- **Runtime**: Node.js + TypeScript (ESM, `NodeNext` module resolution)
- **HTTP framework**: Fastify 5
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Auth**: JWT (`@fastify/jwt`), Argon2id password hashing
- **Validation**: Zod schemas per module

Layout:

```
src/
  app.ts              Fastify app builder, route registration
  server.ts            Entrypoint
  lib/                 config, prisma client, errors, password hashing,
                       template engine, default templates, activity helper
  plugins/             auth (JWT), tenant (business membership), errorHandler
  modules/
    auth/               register, login, me
    business/           business settings
    customers/          customer CRUD + profile aggregation
    leads/               lead funnel, status transitions, message generation
    templates/           message templates
    reviews/             review requests
    feedback/            private feedback
    reminders/           comeback reminders
    dashboard/           dashboard summary aggregation
prisma/
  schema.prisma
  migrations/
```

Every route module follows: `*.schemas.ts` (Zod) → `*.service.ts` (business logic, Prisma calls) → `*.routes.ts` (Fastify handlers, thin).

## 2. Database

See `prisma/schema.prisma` for the authoritative schema. Key points:

- All IDs are UUIDs (`@default(uuid())`).
- Every business-owned table has a `business_id` foreign key with an index.
- Timestamps: `created_at` on all tables, `updated_at` (auto) where records mutate.
- Enums are used for all status/type fields (`LeadStatus`, `ReviewRequestStatus`, `ReminderStatus`, `MessageType`, `MessageChannel`, `FeedbackSentiment`, `FeedbackStatus`, `ActivityEventType`, `BusinessRole`, `MessageTone`).
- Composite/lookup indexes: `(business_id, status)`, `(business_id, created_at)`, `(business_id, due_date)` on relevant tables to support dashboard and list queries.

### Running migrations

```
npx prisma migrate dev     # create + apply a new migration (dev)
npx prisma migrate deploy  # apply pending migrations (prod)
npx prisma generate        # regenerate the client
```

## 3. Authentication

Access JWTs are signed with `JWT_SECRET` and expire after 15 minutes by default. Opaque refresh tokens rotate on every use and expire after 30 days. PostgreSQL stores only SHA-256 refresh-token hashes. Passwords are normalized by email identity and hashed with Argon2id (`src/lib/password.ts`).

| Endpoint | Method | Auth | Body | Response |
|---|---|---|---|---|
| `/auth/register` | POST | none | `{ email, password, fullName, businessName, industry? }` | `201 { accessToken, refreshToken, expiresIn, tokenType, token, user, business }` |
| `/auth/login` | POST | none | `{ email, password }` | `200 { accessToken, refreshToken, expiresIn, tokenType, token, user, business, role }` |
| `/auth/google` | POST | none | `{ idToken }` | `200 { accessToken, refreshToken, expiresIn, tokenType, token, user, business, role, isNewUser }` |
| `/auth/google/link` | POST | Bearer | `{ idToken }` | `200 { provider, providerEmail, linkedAt }` |
| `/auth/apple/challenge` | POST | none | `{}` | `200 { challengeId, nonce, state, expiresAt }` |
| `/auth/apple` | POST | none | Apple credential payload | `200 { accessToken, refreshToken, expiresIn, tokenType, token, user, business, role, isNewUser }` |
| `/auth/apple/link/challenge` | POST | Bearer | `{}` | `200 { challengeId, nonce, state, expiresAt }` |
| `/auth/apple/link` | POST | Bearer | Apple credential payload | `200 { provider, providerEmail, linkedAt }` |
| `/auth/apple/delete/challenge` | POST | Bearer | `{}` | `200 { challengeId, nonce, state, expiresAt }` |
| `/auth/refresh` | POST | none | `{ refreshToken }` | `200 { accessToken, refreshToken, expiresIn, tokenType, token }` |
| `/auth/logout` | POST | none | `{ refreshToken }` | `204` |
| `/auth/logout-all` | POST | Bearer | `{}` | `204` |
| `/auth/forgot-password` | POST | none | `{ email }` | `202 { message }` |
| `/auth/reset-password` | POST | none | `{ token, password }` | `200 { message }` |
| `/auth/delete-account` | POST | Bearer | `{ password }`, `{ googleIdToken }`, or `{ apple: AppleCredentialPayload }` | `204` |
| `/auth/me` | GET | Bearer | — | `200 { user, business, role }` |

Registration creates the user, hashes the password, creates the business, creates the `OWNER` business membership, and creates the initial session in one transaction. `token` is a temporary compatibility alias for `accessToken`.

Send `accessToken` as `Authorization: Bearer <token>` on authenticated requests. Refresh tokens are accepted only in the JSON bodies of `/auth/refresh` and `/auth/logout`. A replayed rotated token revokes its entire token family.

`AppleCredentialPayload` is `{ challengeId, nonce, state, identityToken, authorizationCode, givenName?, familyName? }`. The identity token and authorization code are the identity evidence. The optional name is display metadata returned only on Apple's first authorization and is never used to resolve or link an identity.

## 4. Authorization & Multi-Tenancy

**Critical invariant: a `business_id` is never accepted from the client.** Every authenticated route (except `/auth/*` and `POST /business`) resolves the caller's business server-side via the `requireBusiness` preHandler (`src/plugins/tenant.ts`), which looks up the caller's `BusinessMember` row. `request.businessId` is then used to scope every Prisma query (`WHERE business_id = ...`).

MVP assumes one business per user. The `business_members` table already models many-to-many for future multi-staff support.

Every list/get/update service function additionally filters by `businessId` at the query level (not just at the route level), so a leaked or guessed ID from another tenant returns `404 Not Found`, never another business's data.

## 5. API Reference

All responses are JSON. All list endpoints are scoped to the caller's business automatically.

### Business — `/business`

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/` | — | Returns the caller's business |
| POST | `/` | `{ name, industry?, phone? }` | Only if the user has no business yet |
| PATCH | `/` | `{ name?, industry?, phone?, googleReviewLink?, workingHours?, defaultServices?, reminderDays?, preferredTone? }` | Partial update |

### Customers — `/customers`

| Method | Path | Notes |
|---|---|---|
| GET | `/?search=&page=&pageSize=` | Paginated, searches name/phone/email |
| POST | `/` | `{ name, phone?, email?, notes? }` |
| GET | `/:id` | Full profile: customer, leads, reviewRequests, feedback, reminders, activity, `lifetimeValue` (sum of `estimatedValue` on won leads) |
| PATCH | `/:id` | Partial update |

### Leads — `/leads`

| Method | Path | Notes |
|---|---|---|
| GET | `/?status=&page=&pageSize=` | Includes `responseTimeSeconds` (derived, `contactedAt - missedCallTime`) |
| POST | `/` | `{ customerId?, source?, missedCallTime?, serviceRequested?, urgency?, estimatedValue?, notes? }` |
| GET | `/:id` | Includes customer + messages |
| PATCH | `/:id` | `{ customerId?, source?, serviceRequested?, urgency?, estimatedValue?, notes? }`. **Does not accept `status`** — a `status` field in the body is silently stripped and has no effect. |
| POST | `/:id/generate-message` | Renders the `missed_call` template for this lead, saves to `generatedReply` |
| POST | `/:id/mark-contacted` | Sets `status=contacted`, `contactedAt=now`, records `LEAD_CONTACTED` |
| POST | `/:id/mark-booked` | Sets `status=booked`, `bookedAt=now`, records `LEAD_BOOKED` |
| POST | `/:id/mark-won` | Sets `status=won`, `wonAt=now`, records `LEAD_WON` |
| POST | `/:id/mark-lost` | Sets `status=lost`, `lostAt=now`, records `LEAD_LOST` |

Lead statuses: `new → contacted → booked → won | lost` (transitions are not strictly enforced in sequence — any explicit mark-* endpoint can be called at any time, matching the manual nature of the MVP).

**The `mark-*` endpoints are the only way to change a lead's status.** This is intentional: each one atomically sets `status` together with its corresponding timestamp (`contactedAt`/`bookedAt`/`wonAt`/`lostAt`) and records the matching activity event. A generic PATCH cannot be used to set `status` directly, because doing so would let a client move a lead to e.g. `won` without ever stamping `wonAt` — silently breaking response-time analytics and revenue calculations that depend on that timestamp being present whenever `status` says it should be.

### Message Templates — `/message-templates`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | All templates for the business |
| POST | `/` | `{ templateType, name, body, tone?, isDefault? }`. Setting `isDefault: true` unsets any other default of the same `templateType`. |
| PATCH | `/:id` | Partial update, same default-unset behavior |

Template types: `missed_call`, `booking_confirmation`, `review_request`, `private_feedback`, `comeback_reminder`, `custom`.

Variables: `{{customer_name}}`, `{{business_name}}`, `{{service_name}}`, `{{booking_time}}`, `{{review_link}}`, `{{phone_number}}`. Unrecognized/missing variables are left as-is (not blanked), so authors notice a typo.

If a business has no template of a given type, `generate-message` endpoints fall back to `src/lib/defaultTemplates.ts`, which has industry-aware overrides for a subset of industries and a generic default otherwise.

### Review Requests — `/review-requests`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | All for the business |
| POST | `/` | `{ customerId?, serviceName?, message? }`. Copies `googleReviewLink` from business settings. |
| GET | `/:id` | Includes customer + feedback |
| PATCH | `/:id` | `{ serviceName?, message? }`. **Does not accept `status`** — a `status` field in the body is silently stripped and has no effect. |
| POST | `/:id/generate-message` | Renders `review_request` template |
| POST | `/:id/mark-opened` | Sets `status=opened`, records `REVIEW_OPENED` |
| POST | `/:id/mark-sent` | `status=sent`, `sentAt=now`, records `REVIEW_REQUEST_SENT` |
| POST | `/:id/mark-reviewed` | `status=reviewed`, records `REVIEW_RECEIVED` |
| POST | `/:id/mark-feedback-received` | `status=feedback_received`, records `FEEDBACK_RECEIVED` (also triggered automatically by `POST /feedback` when `reviewRequestId` is set — see §Feedback) |

Statuses: `pending → sent → opened → reviewed | feedback_received`. Like leads, every status transition goes through a dedicated `mark-*` endpoint, which is the only mechanism that changes `status` — this keeps each transition's status change, any related timestamp (`sentAt`), and its activity event atomic and consistent. PATCH is for metadata edits only.

Policy: the private feedback path exists to let a business resolve a concern, not to suppress public reviews — there is no endpoint that blocks or gates the public review link based on rating.

### Feedback — `/feedback`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | All for the business |
| POST | `/` | `{ customerId?, reviewRequestId?, rating (1-5), comment? }`. `sentiment` is derived server-side from `rating` (`>=4` positive, `3` neutral, `<=2` negative) — no external AI call. If `reviewRequestId` is set, that review request transitions to `feedback_received` (same transition as `POST /review-requests/:id/mark-feedback-received`, including its activity event — not logged twice if the review request is already in that status). |
| PATCH | `/:id` | `{ status }` where `status` is one of `new`, `acknowledged`, `resolved`. This is the only field PATCH accepts for feedback — unlike leads/review-requests/reminders, feedback's status is not a lifecycle tied to other timestamps, so a direct status PATCH is safe here. Records `FEEDBACK_STATUS_UPDATED`. |

Feedback statuses: `new → acknowledged → resolved`. Set by the business to track whether a piece of feedback has been looked at, independent of the review request's own status.

### Reminders — `/reminders`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | All for the business, ordered by `dueDate` |
| POST | `/` | `{ customerId?, serviceName?, lastVisitDate?, dueDate? }`. If `dueDate` omitted, computed as `lastVisitDate + business.reminderDays`. |
| GET | `/:id` | — |
| PATCH | `/:id` | `{ serviceName?, lastVisitDate?, dueDate? }`. **Does not accept `status`** — a `status` field in the body is silently stripped and has no effect. |
| POST | `/:id/generate-message` | Renders `comeback_reminder` template |
| POST | `/:id/mark-sent` | `status=sent`, records `REMINDER_SENT` |
| POST | `/:id/mark-completed` | `status=completed`, records `REMINDER_COMPLETED` |
| POST | `/:id/dismiss` | `status=dismissed`, records `REMINDER_DISMISSED` |

Statuses: `due → sent → completed | dismissed`. As with leads and review requests, status changes only happen through the dedicated `mark-*`/`dismiss` endpoints, which pair the status change with its activity event; PATCH is for metadata edits only.

### Dashboard — `/dashboard/summary`

`GET /dashboard/summary` returns:

```jsonc
{
  "recoveredRevenue": { "total": number, "missedCall": number, "comebackCompletedCount": number },
  "leads": { "missedCalls", "new", "contacted", "booked", "won", "lost", "total", "conversionRate", "contactRate" },
  "reviews": { "requestsSent", "reviewsReceived", "feedbackReceived" },
  "customersDue": number, // count of due REMINDER ROWS, not distinct customers — see below
  "responseTime": { "averageSeconds": number|null, "sampleSize": number },
  "recentActivity": ActivityEvent[],
  "todayAttentionItems": [{ "type": "reminder_due", "id", "customerName", "dueDate" }],
  "generatedAt": string,
  "windowStart": string
}
```

All figures are computed live from actual records — no fabricated benchmarks or placeholder numbers.

**`customersDue` semantics**: this field is a count of `Reminder` rows with `status=due` and `dueDate <= now`, **not** a count of distinct customers. If one customer has two overdue reminders, both are counted, so `customersDue` can exceed the number of customers who actually need attention. Treat it as "how many reminders are overdue," not "how many customers are overdue." If the product later needs a true distinct-customer count, that requires changing the query (e.g. `groupBy`/`distinct` on `customerId`), not just renaming the field.

## 6. Business Rules

### Response time
`responseTimeSeconds = contactedAt - missedCallTime`, computed only when both timestamps exist. Never estimated or defaulted.

### Revenue recovery
`estimatedValue` on a `won` lead is the unit of recovered revenue. `recoveredRevenue.total` sums `estimatedValue` across all won leads; `missedCall` sums won leads where `source = "missed_call"`. No revenue figure is invented — everything traces to a lead record.

### Customer return logic (MVP)
Manual timing only: `reminder.dueDate = customer.lastVisitDate + business.reminderDays` (default 42 days / 6 weeks), configurable per business via `PATCH /business`. No predictive modeling in MVP; the `reminders` table is shaped to support historical-pattern-based due dates later without a schema change.

### Lifetime value
On a customer profile, `lifetimeValue` = sum of `estimatedValue` across that customer's `won` leads.

## 7. Status Transitions Reference

| Entity | Statuses | Terminal? |
|---|---|---|
| Lead | `new, contacted, booked, won, lost` | `won`, `lost` |
| ReviewRequest | `pending, sent, opened, reviewed, feedback_received` | `reviewed`, `feedback_received` |
| Reminder | `due, sent, completed, dismissed` | `completed`, `dismissed` |
| Feedback | `new, acknowledged, resolved` | `resolved` |

## 8. Templates

Default bodies live in `src/lib/defaultTemplates.ts`, keyed by `MessageType` with optional per-industry overrides (`barber`, `dentist`, `restaurant` currently; extend the map, not the code, for more). A business's own `message_templates` rows always take priority over defaults; the `isDefault` flag picks which row is used when a business has multiple templates of the same type.

Rendering (`src/lib/templateEngine.ts`) is pure string substitution — `{{var}}` — no external calls, no LLM.

## 9. Security

- Passwords: Argon2id, never logged, never returned in API responses. Provider-only users may have a null password hash.
- Emails: trimmed and lowercased into a unique `normalized_email`; all email/password lookups use this canonical value.
- Sessions: access JWTs are short-lived and tied to a server session; refresh/reset tokens are random opaque values and only their SHA-256 hashes are stored.
- Password resets: one-hour expiry by default, single-use, five requests/hour per client, and successful reset revokes every user session.
- Provider identities: uniqueness is `(provider, provider_subject)` with an additional one-identity-per-provider-per-user constraint. Provider claims are accepted only after server-side token verification.
- Google identity tokens are verified server-side for signature, issuer, audience, expiry, verified email, and token structure. Identity resolution uses the stable Google `sub`, never a client-supplied ID or email.
- A matching email without an existing Google identity returns `ACCOUNT_LINK_REQUIRED`; linking requires an authenticated Chakusa session plus a freshly issued verified Google token.
- Apple identity tokens are verified against Apple's JWKS for signature, issuer, App ID audience, expiry, verified email, stable `sub`, and the server-issued nonce. State and nonce challenges are hashed, expire after five minutes by default, and are transactionally single use.
- Apple authorization codes are exchanged server-side. Apple refresh credentials are encrypted with AES-256-GCM before storage and are revoked before account deletion. Identity resolution uses `APPLE + sub`; email is never sufficient to merge accounts or memberships.
- Apple's native name fields are accepted only after the token, challenge, and authorization code are verified. They populate a new user's display name once and are not identity claims.
- JWT secret and database credentials live only in `.env` (gitignored), read via `src/lib/config.ts` (Zod-validated at boot — the process refuses to start with a missing/weak secret).
- All Prisma queries are parameterized by the client library (no raw SQL string concatenation anywhere in the codebase).
- `business_id` is always server-resolved (§4) — the single most important tenant-isolation guarantee.
- Rate limiting: 200 requests/minute per client globally via `@fastify/rate-limit`, with stricter per-route limits on authentication endpoints — `/auth/login` (10/15min), `/auth/register` (20/15min), `/auth/refresh` (30/15min), `/auth/google` (20/15min), `/auth/google/link` (10/15min), `/auth/apple*` (5–30/15min depending on sensitivity), and `/auth/forgot-password` (5/hour). All rate-limit rejections return `429 RATE_LIMITED` in the standard error format.
- Login timing: `POST /auth/login` runs the same-cost Argon2id verification whether or not the email is registered (a fixed dummy hash is used for nonexistent accounts), so response time cannot be used to enumerate which emails have accounts.
- Errors never leak stack traces to the client; unexpected errors are logged server-side and returned as a generic `500 INTERNAL_ERROR`.

## 10. Error Format

```jsonc
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": { /* optional */ } } }
```

| HTTP | code |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |

Authentication failures use explicit codes: `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_INVALID`, `AUTH_SESSION_EXPIRED`, `AUTH_REFRESH_REUSED`, `AUTH_RESET_TOKEN_INVALID`, `AUTH_RESET_TOKEN_EXPIRED`, `AUTH_RESET_TOKEN_USED`, `AUTH_REAUTHENTICATION_REQUIRED`, and `AUTH_PASSWORD_UNAVAILABLE`.

Google authentication additionally uses `GOOGLE_AUTH_NOT_CONFIGURED`, `GOOGLE_TOKEN_INVALID`, `ACCOUNT_LINK_REQUIRED`, `AUTH_IDENTITY_CONFLICT`, and `AUTH_PROVIDER_ALREADY_LINKED`.

Apple authentication additionally uses `APPLE_AUTH_NOT_CONFIGURED`, `APPLE_TOKEN_INVALID`, `APPLE_CODE_INVALID`, `APPLE_CHALLENGE_INVALID`, `APPLE_CHALLENGE_EXPIRED`, `APPLE_CHALLENGE_USED`, and `APPLE_REVOCATION_FAILED`.

## 11. Testing

Run with `npm test`. Tests boot the real Fastify app against the local Postgres instance (see `docker-compose.yml`) and exercise the HTTP layer directly. Coverage includes: registration/login, `/auth/me`, cross-business data isolation (the tenant-isolation guarantee from §4), customer CRUD, lead creation + status transitions + response-time calculation, revenue calculation, review request lifecycle, feedback + sentiment derivation, reminders + due-date computation, template rendering, and dashboard aggregation correctness.

## 12. Environment Variables

See `.env.example`:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — signing secret, min 16 chars (use a long random value in production)
- `PORT` — HTTP port (default 4000)
- `NODE_ENV` — `development | test | production`
- `GOOGLE_AUTH_ENABLED` — `true`/`false` (default `false`). In production, setting this to `true` makes `GOOGLE_OAUTH_CLIENT_IDS` mandatory at boot (the process refuses to start without it). In development/test, Google credentials may remain unset regardless of this flag; unconfigured Google endpoints fail per-request with `503 GOOGLE_AUTH_NOT_CONFIGURED` rather than at boot.
- `APPLE_AUTH_ENABLED` — `true`/`false` (default `false`). In production, setting this to `true` makes `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY_BASE64`, and `PROVIDER_TOKEN_ENCRYPTION_KEY` all mandatory at boot. Same fail-safe behavior as Google when unset in development/test.
