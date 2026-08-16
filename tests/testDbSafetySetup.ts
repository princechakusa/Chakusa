/**
 * Production Safety Phase 2.1 — startup layer.
 *
 * Registered as Vitest's setupFiles entry (see vitest.config.ts), which
 * Vitest imports once before any test file runs. Throwing here aborts the
 * entire run immediately — no test body, no beforeAll/afterEach hook, and
 * critically no resetDatabase() call ever executes if this throws. This is
 * the first of two independent layers; the second is
 * assertDestructiveTestDatabaseAccessAllowed() called again at the top of
 * resetDatabase() itself (tests/helpers.ts), in case this file is ever
 * bypassed by a different invocation path.
 */
import { assertDestructiveTestDatabaseAccessAllowed, describeTestDatabaseTarget } from "./dbSafetyGuard.js";

assertDestructiveTestDatabaseAccessAllowed();

console.log("[test-db-safety] verified:", describeTestDatabaseTarget());
