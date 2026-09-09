# AUTONOMOUS CONTINUATION — AFTER #21

**Current verified report position:** stages #18 Omnichannel, #19 Marketplace, #20 Reputation and #21 Booking Distribution have been completed by the coding agent and reported under `docs/progress/`.

## Immediate instruction

1. Read `CLAUDE.md`.
2. Read `docs/CHAKUSA_AUTONOMOUS_MASTER_ROADMAP.md`.
3. Read `docs/OWNER_DECISION_OA6_STAGE22_WEB.md` — this resolves OA-6 and authorizes #22.
4. Inspect the actual local repository/HEAD and the stage reports before changing code. The coding session may contain local commits not yet pushed to GitHub; **local repository state is authoritative over this remote continuation marker**. Never reset, discard, overwrite or revert those local commits merely to match GitHub.
5. Continue with #22 Desktop/Web using the approved architecture and scope.
6. After #22 passes its completion gate, continue automatically through #23 Production Hardening, #24 Security & Privacy Audit, #25 Manual QA Preparation and #26 Release Readiness wherever work can be completed without external owner actions.

## Important external actions

Continue tracking but do not unnecessarily block independent engineering work on:

- OA-1 production migration deployment / backup preconditions.
- OA-5 Apple/Android app-link identifiers/configuration.
- production provider/API credentials where genuinely absent.
- store-console declarations/actions requiring owner access or attestation.
- physical-device actions that require the owner/device.

At a stage containing both autonomous work and an external action, complete all safe autonomous work first. Record the external item precisely in `docs/OWNER_ACTIONS.md` and continue to other independent work where the governing roadmap permits it.

## Do not wait for stage-by-stage approval

For reversible engineering decisions, choose the safest maintainable solution, test it, audit it, document it, commit it and continue.

Do not ask the owner to approve ordinary:
- naming
- refactoring
- component structure
- test framework choice
- gateway helper structure
- API client organization
- responsive breakpoints
- accessibility implementation details
- test fixture repair
- additive indexes/migrations that pass the migration safety rules

The stopping conditions remain only those in the root `CLAUDE.md` and master roadmap.

## Release boundary

Do not claim production release complete until required owner-side deployment, credentials, store declarations, app-link identifiers and physical-device QA are actually complete. Engineering may proceed up to that boundary and should leave exact executable owner actions rather than vague blockers.
