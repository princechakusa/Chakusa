import { config } from "../../lib/config.js";

export async function sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
  if (!config.RESEND_API_KEY || !config.EMAIL_FROM) {
    return false;
  }

  const resetUrl = new URL(config.PASSWORD_RESET_URL);
  resetUrl.searchParams.set("token", token);
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
        subject: "Reset your Chakusa password",
        html: `<p>Use the link below to reset your Chakusa password.</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>This link expires soon and can only be used once.</p>`,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
