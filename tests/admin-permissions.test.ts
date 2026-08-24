import { describe, expect, it } from "vitest";
import { adminRoleHasPermission, permissionsForAdminRole } from "../src/modules/admin/admin.permissions.js";

describe("platform admin permission matrix", () => {
  it("grants every capability only to the super admin role", () => {
    expect(adminRoleHasPermission("SUPER_ADMIN", "admin.manage")).toBe(true);
    expect(adminRoleHasPermission("PLATFORM_ADMIN", "admin.manage")).toBe(false);
  });

  it("keeps read-only administrators free of mutation permissions", () => {
    const permissions = permissionsForAdminRole("READ_ONLY");
    expect(permissions).toContain("business.read");
    expect(permissions).toContain("audit.read");
    expect(permissions.some((permission) => permission.endsWith(".manage") || permission.endsWith(".delete") || permission.endsWith(".retry"))).toBe(false);
  });

  it("does not give support agents destructive business controls", () => {
    expect(adminRoleHasPermission("SUPPORT_AGENT", "support.manage")).toBe(true);
    expect(adminRoleHasPermission("SUPPORT_AGENT", "business.delete")).toBe(false);
    expect(adminRoleHasPermission("SUPPORT_AGENT", "settings.manage")).toBe(false);
  });
});
