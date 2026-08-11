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

JWT bearer tokens signed with `JWT_SECRET`, 30-day expiry. Passwords hashed with Argon2id (`src/lib/password.ts`).

| Endpoint | Method | Auth | Body | Response |
|---|---|---|---|---|
| `/auth/register` | POST | none | `{ email, password, fullName, businessName, industry? }` | `201 { token, user, business }` |
| `/auth/login` | POST | none | `{ email, password }` | `200 { token, user, business, role }` |
| `/auth/me` | GET | Bearer | — | `200 { user, business, role }` |

Registration creates the user, hashes the password, creates the business, creates the `OWNER` business membership, and returns a token — all in one transaction.

Send the token as `Authorization: Bearer <token>` on all subsequent requests.

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
| PATCH | `/:id` | Any lead field including direct `status` set |
| POST | `/:id/generate-message` | Renders the `missed_call` template for this lead, saves to `generatedReply` |
| POST | `/:id/mark-contacted` | Sets `status=contacted`, `contactedAt=now`, records `LEAD_CONTACTED` |
| POST | `/:id/mark-booked` | Sets `status=booked`, `bookedAt=now`, records `LEAD_BOOKED` |
| POST | `/:id/mark-won` | Sets `status=won`, `wonAt=now`, records `LEAD_WON` |
| POST | `/:id/mark-lost` | Sets `status=lost`, `lostAt=now`, records `LEAD_LOST` |

Lead statuses: `new → contacted → booked → won | lost` (transitions are not strictly enforced in sequence — any explicit mark-* endpoint can be called at any time, matching the manual nature of the MVP).

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
| PATCH | `/:id` | `{ serviceName?, message?, status? }` |
| POST | `/:id/generate-message` | Renders `review_request` template |
| POST | `/:id/mark-sent` | `status=sent`, `sentAt=now` |
| POST | `/:id/mark-reviewed` | `status=reviewed` |
| POST | `/:id/mark-feedback-received` | `status=feedback_received` |

Statuses: `pending → sent → opened → reviewed | feedback_received`. `opened` is set via PATCH (no dedicated webhook/tracking in MVP).

Policy: the private feedback path exists to let a business resolve a concern, not to suppress public reviews — there is no endpoint that blocks or gates the public review link based on rating.

### Feedback — `/feedback`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | All for the business |
| POST | `/` | `{ customerId?, reviewRequestId?, rating (1-5), comment? }`. `sentiment` is derived server-side from `rating` (`>=4` positive, `3` neutral, `<=2` negative) — no external AI call. If `reviewRequestId` is set, that review request's status becomes `feedback_received`. |

### Reminders — `/reminders`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | All for the business, ordered by `dueDate` |
| POST | `/` | `{ customerId?, serviceName?, lastVisitDate?, dueDate? }`. If `dueDate` omitted, computed as `lastVisitDate + business.reminderDays`. |
| GET | `/:id` | — |
| PATCH | `/:id` | `{ serviceName?, lastVisitDate?, dueDate?, status? }` |
| POST | `/:id/generate-message` | Renders `comeback_reminder` template |
| POST | `/:id/mark-sent` | `status=sent` |
| POST | `/:id/mark-completed` | `status=completed` |
| POST | `/:id/dismiss` | `status=dismissed` |

Statuses: `due → sent → completed | dismissed`.

### Dashboard — `/dashboard/summary`

`GET /dashboard/summary` returns:

```jsonc
{
  "recoveredRevenue": { "total": number, "missedCall": number, "comebackCompletedCount": number },
  "leads": { "missedCalls", "new", "contacted", "booked", "won", "lost", "total", "conversionRate", "contactRate" },
  "reviews": { "requestsSent", "reviewsReceived", "feedbackReceived" },
  "customersDue": number,
  "responseTime": { "averageSeconds": number|null, "sampleSize": number },
  "recentActivity": ActivityEvent[],
  "todayAttentionItems": [{ "type": "reminder_due", "id", "customerName", "dueDate" }],
  "generatedAt": string,
  "windowStart": string
}
```

All figures are computed live from actual records — no fabricated benchmarks or placeholder numbers.

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

- Passwords: Argon2id, never logged, never returned in API responses.
- JWT secret and database credentials live only in `.env` (gitignored), read via `src/lib/config.ts` (Zod-validated at boot — the process refuses to start with a missing/weak secret).
- All Prisma queries are parameterized by the client library (no raw SQL string concatenation anywhere in the codebase).
- `business_id` is always server-resolved (§4) — the single most important tenant-isolation guarantee.
- Rate limiting: 200 requests/minute per client via `@fastify/rate-limit`.
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
| 500 | `INTERNAL_ERROR` |

## 11. Testing

Run with `npm test`. Tests boot the real Fastify app against the local Postgres instance (see `docker-compose.yml`) and exercise the HTTP layer directly. Coverage includes: registration/login, `/auth/me`, cross-business data isolation (the tenant-isolation guarantee from §4), customer CRUD, lead creation + status transitions + response-time calculation, revenue calculation, review request lifecycle, feedback + sentiment derivation, reminders + due-date computation, template rendering, and dashboard aggregation correctness.

## 12. Environment Variables

See `.env.example`:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — signing secret, min 16 chars (use a long random value in production)
- `PORT` — HTTP port (default 4000)
- `NODE_ENV` — `development | test | production`
