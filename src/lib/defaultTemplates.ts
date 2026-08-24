import type { MessageType } from "@prisma/client";

export const DEFAULT_TEMPLATE_BODIES: Record<MessageType, string> = {
  missed_call:
    "Hi {{customer_name}}, sorry we missed your call at {{business_name}}! We'd love to help with your {{service_name}}. Give us a call back at {{phone_number}} or reply here.",
  booking_confirmation:
    "Hi {{customer_name}}, you're booked in at {{business_name}} for {{service_name}} on {{booking_time}}. See you then!",
  review_request:
    "Hi {{customer_name}}, thanks for choosing {{business_name}}! We'd really appreciate a quick review: {{review_link}}",
  private_feedback:
    "Hi {{customer_name}}, we'd love to hear how your {{service_name}} went at {{business_name}}. Your feedback helps us improve.",
  comeback_reminder:
    "Hi {{customer_name}}, it's been a while since your last {{service_name}} at {{business_name}}. Ready to book again?",
  custom: "Hi {{customer_name}}, this is {{business_name}}.",
  appointment_reminder:
    "Hi {{customer_name}}, a reminder that your {{service_name}} appointment at {{business_name}} is on {{booking_time}}.",
  appointment_same_day_reminder:
    "Hi {{customer_name}}, your {{service_name}} appointment at {{business_name}} is today at {{booking_time}}.",
  appointment_rescheduled:
    "Hi {{customer_name}}, your {{service_name}} appointment at {{business_name}} has moved to {{booking_time}}.",
  appointment_canceled:
    "Hi {{customer_name}}, your {{service_name}} appointment at {{business_name}} on {{booking_time}} has been canceled.",
  appointment_follow_up:
    "Hi {{customer_name}}, thank you for visiting {{business_name}} for your {{service_name}}. We hope to see you again.",
  public_profile_inquiry:
    "Hi {{customer_name}}, thanks for reaching out to {{business_name}} about your {{service_name}}! We'll get back to you shortly — feel free to call us at {{phone_number}} in the meantime.",
  lead_follow_up:
    "Hi {{customer_name}}, just checking in from {{business_name}} about your {{service_name}} — still interested? Call us at {{phone_number}} or reply here.",
};

// Industry-aware overrides. Only industries with a meaningfully different
// default tone/wording are listed; others fall back to DEFAULT_TEMPLATE_BODIES.
export const INDUSTRY_TEMPLATE_OVERRIDES: Partial<Record<string, Partial<Record<MessageType, string>>>> = {
  barber: {
    missed_call:
      "Hey {{customer_name}}, sorry we missed you at {{business_name}}! Want to grab a new time for your {{service_name}}? Call {{phone_number}}.",
  },
  dentist: {
    missed_call:
      "Hello {{customer_name}}, this is {{business_name}}. We missed your call regarding {{service_name}}. Please call us back at {{phone_number}} to reschedule.",
    comeback_reminder:
      "Hello {{customer_name}}, it's time for your next checkup at {{business_name}}. Please call {{phone_number}} to book.",
  },
  restaurant: {
    review_request:
      "Hi {{customer_name}}, thanks for dining with us at {{business_name}}! We'd love a review: {{review_link}}",
  },
};

export function getDefaultTemplateBody(templateType: MessageType, industry?: string | null): string {
  const override = industry ? INDUSTRY_TEMPLATE_OVERRIDES[industry]?.[templateType] : undefined;
  return override ?? DEFAULT_TEMPLATE_BODIES[templateType];
}
