import { config } from "../../lib/config.js";
import type { WeeklyReportSummary } from "./weeklyReports.service.js";

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!)); }

/** Optional Resend delivery. The durable in-app report remains authoritative. */
export async function sendWeeklyOwnerReportEmail(email: string, businessName: string, weekKey: string, summary: WeeklyReportSummary) {
  if (!config.RESEND_API_KEY || !config.EMAIL_FROM) return false;
  const safeName = escapeHtml(businessName);
  try {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: config.EMAIL_FROM, to: [email], subject: `${businessName} weekly report · ${weekKey}`, html: `<h2>${safeName} weekly report</h2><ul><li>${summary.appointmentsBooked} appointments booked</li><li>${summary.appointmentsCompleted} appointments completed</li><li>${summary.newCustomers} new customers</li><li>${summary.customerMessagesSent} customer messages sent</li><li>${summary.reviewsReceived} reviews received</li></ul>` }) });
    return response.ok;
  } catch { return false; }
}
