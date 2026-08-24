# Chakusa Admin Console — Phase 0 Security Contract

This contract governs the internal Chakusa administration console. Platform
administration is a separate security boundary from business ownership and
team membership.

## Identity and sessions

- An administrator is an existing `User` with one active `AdminMembership`.
- `BusinessRole` never grants platform access.
- Admin login creates an `ADMIN`-scoped `AuthSession`; product sessions are
  rejected by admin middleware, and admin sessions are rejected by product
  middleware.
- Access tokens are short-lived bearer tokens intended to remain in browser
  memory. The rotating refresh credential is returned only as an HttpOnly,
  `SameSite=Strict` cookie scoped to `/admin/auth`.
- Refresh and cookie-authenticated logout require a session-bound CSRF token.
- The console is disabled unless `ADMIN_CONSOLE_ENABLED=true`. Production
  enablement additionally requires an exact HTTPS `ADMIN_CONSOLE_ORIGIN`.

## Authorization

Routes authorize explicit capabilities, never role-name conditionals. The
central registry is `src/modules/admin/admin.permissions.ts`.

Roles are `SUPER_ADMIN`, `PLATFORM_ADMIN`, `SUPPORT_AGENT`, `FINANCE`,
`OPERATIONS`, and `READ_ONLY`. Only `SUPER_ADMIN` receives `admin.manage`.
Permissions are intentionally defined before the operational endpoints that
will consume them, so later phases cannot invent local permission rules.

## Audit requirements

- Every successful admin mutation and authentication/session action appends
  an `AdminAuditLog` entry.
- The domain mutation and its audit row must share one Prisma transaction.
- Actor ID, email, and role are snapshotted; audit history has no foreign key
  that can cascade or mutate after an account/role change.
- Secret-like keys are redacted before JSON reaches the database.
- PostgreSQL triggers reject row-level update and delete operations on the
  audit table.
- Controllers never write audit rows or domain tables directly; services own
  both the command and audit orchestration.

## First administrator

Bootstrap is deliberately one-time and fail-closed. It only promotes an
existing password-enabled Chakusa user when there are zero admin memberships:

```text
npm run admin:bootstrap -- user@example.com --confirm-create-first-super-admin
```

Once any admin exists, this command refuses to run. Later administrator
changes must use the permission-checked, audited management flow.

## Phase 0 metric decisions still required

Before analytics implementation, product owners must approve canonical
definitions for active/dormant businesses, recovered leads, ratings, and the
authoritative billing source for MRR/ARR. The console must not fabricate those
figures from incomplete data.
