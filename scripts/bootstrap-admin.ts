import { prisma } from "../src/lib/prisma.js";
import { normalizeEmail } from "../src/lib/email.js";
import { recordAdminAudit } from "../src/modules/admin/adminAudit.service.js";

const [email, confirmation] = process.argv.slice(2);

if (!email || confirmation !== "--confirm-create-first-super-admin") {
  console.error("Usage: npm run admin:bootstrap -- <existing-user-email> --confirm-create-first-super-admin");
  process.exit(1);
}

try {
  const user = await prisma.user.findUnique({ where: { normalizedEmail: normalizeEmail(email) }, select: { id: true, email: true, passwordHash: true } });
  if (!user) throw new Error("Bootstrap refused: no existing Chakusa user has that email");
  if (!user.passwordHash) throw new Error("Bootstrap refused: the first administrator must have password authentication configured");

  const membership = await prisma.$transaction(async (tx) => {
    if (await tx.adminMembership.count()) {
      throw new Error("Bootstrap refused: an admin membership already exists; use the audited admin-management flow instead");
    }
    const created = await tx.adminMembership.create({ data: { userId: user.id, role: "SUPER_ADMIN" } });
    await recordAdminAudit({
      actor: { membershipId: created.id, userId: user.id, email: user.email, role: created.role },
      action: "ADMIN_BOOTSTRAPPED",
      targetType: "admin_membership",
      targetId: created.id,
      newValue: { userId: user.id, role: created.role },
      context: { userAgent: "scripts/bootstrap-admin.ts" },
    }, tx);
    return created;
  }, { isolationLevel: "Serializable" });
  console.log(`Created first SUPER_ADMIN membership ${membership.id} for ${user.email}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Admin bootstrap failed");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
