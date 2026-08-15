import { config } from "../../lib/config.js";
import { buildTeamInviteUrl } from "./teamInviteLinks.js";

/**
 * Reuses the exact Resend integration passwordResetEmail.ts already
 * established — same config gate (RESEND_API_KEY + EMAIL_FROM), same
 * fire-and-forget-boolean contract, same never-throw discipline. No new
 * email provider is introduced (see the Business Phase 1 report's "email
 * invitation behavior" section): when Resend isn't configured, this
 * returns false and the caller logs a warning — the invitation itself is
 * still created and its raw link is still returned to the inviting owner
 * (see teamInvitations.service.ts), so team invitations work end-to-end
 * without email transport, just without automatic delivery.
 */
export async function sendTeamInvitationEmail(
  email: string,
  token: string,
  businessName: string,
  inviterName: string,
): Promise<boolean> {
  if (!config.RESEND_API_KEY || !config.EMAIL_FROM) {
    return false;
  }

  const inviteUrl = buildTeamInviteUrl(token);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [email],
        subject: `${inviterName} invited you to join ${businessName} on Chakusa`,
        html: `<p>${inviterName} invited you to join <strong>${businessName}</strong> on Chakusa.</p><p><a href="${inviteUrl}">Accept invitation</a></p><p>This link expires soon and can only be used once.</p>`,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
