# CLAUDE.md — CHAKUSA AUTONOMOUS EXECUTION DIRECTIVE

This repository is developed under an autonomous, stage-gated production workflow.

## FIRST ACTION

Before making implementation changes, read:

1. `docs/CHAKUSA_AUTONOMOUS_MASTER_ROADMAP.md` — governing product/engineering roadmap.
2. `docs/CHAKUSA_ENGINEERING_SPEC.md` — existing engineering specification.
3. Relevant subsystem documentation under `docs/`.
4. Git status, recent history, Prisma migration state, package scripts, and the code/tests for the stage being worked on.

The master roadmap supersedes older ad-hoc continuation prompts when they conflict on forward execution order. Existing security/data invariants in code and engineering docs remain authoritative unless the roadmap explicitly tightens them.

## OPERATING MODE

Use:

`PROJECT → PHASE → STAGE → INSPECT → DESIGN → IMPLEMENT → TEST → AUDIT → COMMIT → CONTINUE`

Do not stop after every green stage to ask whether to continue.

Proceed autonomously to the next roadmap stage after the completion gate passes.

For normal reversible engineering decisions, choose the safest maintainable option, test it, document it, and continue.

Stop only for a genuine external/irreversible owner decision such as:

- destructive production action
- unresolved production backup/recovery prerequisite
- new paid provider/vendor commitment
- unavailable credential/secret/account permission
- legal/compliance declaration requiring owner attestation
- store-console action requiring the owner
- materially different irreversible product choices

If only one task is blocked by an owner action, record it in `docs/OWNER_ACTIONS.md` and continue all independent safe roadmap work.

## CURRENT ROADMAP POSITION

Stages through **#17 No-show Automation** are considered completed subject to repository verification.

**NEXT: controlled production deployment/migration checkpoint before #18.**

After that:

- #18 Omnichannel Communications
- #19 Marketplace & Discovery Completion
- #20 Reputation & Review Growth
- #21 Booking Distribution
- #22 Desktop/Web Business Experience
- #23 Production Hardening
- #24 Pre-release Security & Privacy Audit
- #25 Manual QA Preparation
- #26 Release Readiness & Store Compliance

Then process the controlled post-V1 backlog from the master roadmap.

## NON-NEGOTIABLES

- Inspect before implementation.
- Reuse existing architecture.
- Protect working functionality.
- Backend authorization is authoritative.
- Tenant isolation everywhere.
- Entitlement != authorization; both must pass where applicable.
- AI/model output never authorizes tools/actions.
- Payment/financial truth is server/provider verified.
- Prefer additive migrations; never reset/drop production as a shortcut.
- No permanent live-location history or workforce surveillance.
- No predictive/punitive no-show scoring.
- No giant duplicate subsystems.
- No weakening tests to force green.
- Physical-device QA is a final release gate, not a blocker for ordinary implementation.
- Do not remove native dependencies just to support Expo Go.

## COMPLETION REPORTS

For every major stage, create/update a report under `docs/progress/` containing:

- stage and status
- baseline inspected
- architecture reused
- implementation
- authorization/tenant/security model
- migrations
- tests/regressions/typechecks
- commits
- unresolved limitations
- owner actions, if any
- next stage

Keep `docs/CHAKUSA_AUTONOMOUS_MASTER_ROADMAP.md` aligned with material roadmap progress.

## IMPORTANT

A schema, feature flag, placeholder, route, or screen does not prove a feature is complete. Verify the complete production path and its failure/security behavior before closing the stage.
