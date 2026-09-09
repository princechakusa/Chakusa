import { describe, expect, it } from "vitest";
import { CAPABILITIES, can as backendCan } from "../src/lib/capabilities.js";
// The website's UX-only mirror. Must never disagree with the backend matrix:
// a mirror that grants more than the backend would show a member an action
// the API then rejects; one that grants less hides a legitimate action.
import { can as webCan } from "../website/src/scripts/capabilities.js";

const ROLES = ["OWNER", "ADMIN", "STAFF"] as const;

describe("#22 web capability mirror stays in sync with the backend matrix", () => {
  for (const role of ROLES) {
    it(`${role}: every capability resolves identically`, () => {
      const mismatches = CAPABILITIES.filter((cap) => backendCan(role, cap) !== webCan(role, cap));
      expect(mismatches).toEqual([]);
    });
  }

  it("an unknown / null role is denied everything by both", () => {
    for (const cap of CAPABILITIES) {
      expect(backendCan(null, cap)).toBe(false);
      expect(webCan(null as unknown as string, cap)).toBe(false);
      expect(webCan("SUPER_ADMIN", cap)).toBe(false);
    }
  });
});
