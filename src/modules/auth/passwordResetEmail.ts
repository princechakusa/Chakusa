import { config } from "../../lib/config.js";
import { createPasswordReset, passwordlessSignInProviders } from "./auth.service.js";

/** Whether the API holds the credentials needed to send reset mail. */
export function outboundEmailConfigured(): boolean {
  return Boolean(config.RESEND_API_KEY && config.EMAIL_FROM);
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!outboundEmailConfigured()) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.EMAIL_FROM, to: [to], subject, html, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const wrap = (body: string) =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#182B29">${body}<p style="color:#8C948E;font-size:12px;margin-top:32px">Chakusa · chakusarecovery.com</p></div>`;

export async function sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
  const resetUrl = new URL(config.PASSWORD_RESET_URL);
  resetUrl.searchParams.set("token", token);
  const minutes = config.PASSWORD_RESET_TTL_MINUTES;
  return sendEmail(
    email,
    "Reset your Chakusa password",
    wrap(`<h2 style="margin:0 0 12px">Reset your password</h2>
<p>Someone (hopefully you) asked to reset the password for this Chakusa account.</p>
<p><a href="${resetUrl.toString()}" style="display:inline-block;background:#182F2D;color:#F6F4E9;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Choose a new password</a></p>
<p>This link works once and expires in ${minutes} minutes. Resetting signs you out on every device.</p>
<p>If you didn't ask for this, ignore this email - your password stays the same.</p>`),
    `Reset your Chakusa password: ${resetUrl.toString()}\n\nThis link works once and expires in ${minutes} minutes. If you didn't ask for this, ignore this email.`,
  );
}

/** "Forgot password" on a Google/Apple account: tell the owner how they actually sign in. */
export async function sendSocialSignInReminderEmail(email: string, providers: string[]): Promise<boolean> {
  const names = providers.map((p) => (p.toUpperCase() === "GOOGLE" ? "Google" : p.toUpperCase() === "APPLE" ? "Apple" : p)).join(" or ");
  return sendEmail(
    email,
    "How to sign in to Chakusa",
    wrap(`<h2 style="margin:0 0 12px">You sign in with ${names}</h2>
<p>Someone (hopefully you) asked to reset the password for this Chakusa account. This account doesn't use a password - it was created with ${names}.</p>
<p>Open Chakusa and tap <b>Continue with ${names}</b> to sign in.</p>
<p>If you didn't ask for this, ignore this email - nothing has changed.</p>`),
    `This Chakusa account signs in with ${names}, not a password. Open Chakusa and tap "Continue with ${names}". If you didn't ask for this, ignore this email.`,
  );
}

/** Security notice after a password change, so an account owner learns of a reset they didn't make. */
export async function sendPasswordChangedEmail(email: string): Promise<boolean> {
  return sendEmail(
    email,
    "Your Chakusa password was changed",
    wrap(`<h2 style="margin:0 0 12px">Your password was changed</h2>
<p>The password for this Chakusa account was just changed and every device was signed out.</p>
<p>If this was you, there's nothing more to do. If it wasn't, reset your password now from the Chakusa sign-in screen and contact support@chakusarecovery.com.</p>`),
    "Your Chakusa password was just changed and every device was signed out. If this wasn't you, reset your password now and contact support@chakusarecovery.com.",
  );
}

/**
 * Issues a reset link, then mails it without the caller waiting on the
 * email provider, so the response time does not reveal whether the account
 * exists (the slow part is the network send). Never throws.
 */
export async function requestPasswordReset(email: string, log: { warn: (msg: string) => void }): Promise<void> {
  const normalized = email.trim().toLowerCase();
  let token: string | null = null;
  try {
    token = await createPasswordReset(normalized);
  } catch {
    log.warn("Password reset request failed");
    return;
  }
  if (!token) {
    // No password on this account (Google/Apple): remind the owner by email.
    // The HTTP response is identical either way, so nothing is revealed.
    const providers = await passwordlessSignInProviders(normalized).catch(() => null);
    if (providers?.length) void sendSocialSignInReminderEmail(normalized, providers).then((ok) => { if (!ok) log.warn("Sign-in reminder email was not delivered"); });
    return;
  }
  const issued = token;
  void sendPasswordResetEmail(normalized, issued).then((delivered) => {
    if (!delivered) log.warn("Password reset email was not delivered");
  });
}
