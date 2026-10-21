import type { MessageTone, MessageType } from '../apiTypes';

// Ready-made message templates a business can copy and adapt. Bodies use
// the same variables the server renders ({{customer_name}}, ...), and the
// friendly versions match the server defaults (src/lib/defaultTemplates.ts),
// so a copied template behaves exactly like the built-in one until edited.

export interface StarterTemplate {
  id: string;
  type: MessageType;
  tone: MessageTone;
  name: string;
  body: string;
}

export const TEMPLATE_LIBRARY: StarterTemplate[] = [
  { id: 'missed-friendly', type: 'missed_call', tone: 'friendly', name: 'Missed call - friendly',
    body: "Hi {{customer_name}}, sorry we missed your call at {{business_name}}! We'd love to help with your {{service_name}}. Give us a call back at {{phone_number}} or reply here." },
  { id: 'missed-professional', type: 'missed_call', tone: 'professional', name: 'Missed call - professional',
    body: 'Hello {{customer_name}}, this is {{business_name}}. We missed your call and want to make sure you are looked after. Please reply here or call us on {{phone_number}} and we will help you straight away.' },
  { id: 'missed-booking', type: 'missed_call', tone: 'casual', name: 'Missed call - book now',
    body: "Hey {{customer_name}}! Sorry we couldn't pick up at {{business_name}}. Reply with a day and time that suits you and we'll get you booked in." },

  { id: 'confirm-friendly', type: 'booking_confirmation', tone: 'friendly', name: 'Booking confirmed - friendly',
    body: "Hi {{customer_name}}, you're booked in at {{business_name}} for {{service_name}} on {{booking_time}}. See you then!" },
  { id: 'confirm-professional', type: 'booking_confirmation', tone: 'professional', name: 'Booking confirmed - with details',
    body: 'Hello {{customer_name}}, your {{service_name}} appointment at {{business_name}} is confirmed for {{booking_time}}. If you need to change it, please call {{phone_number}}.' },

  { id: 'review-friendly', type: 'review_request', tone: 'friendly', name: 'Review request - friendly',
    body: "Hi {{customer_name}}, thanks for choosing {{business_name}}! We'd really appreciate a quick review: {{review_link}}" },
  { id: 'review-professional', type: 'review_request', tone: 'professional', name: 'Review request - professional',
    body: 'Hello {{customer_name}}, thank you for visiting {{business_name}}. If you have a moment, a short review helps others find us: {{review_link}}' },

  { id: 'feedback-friendly', type: 'private_feedback', tone: 'friendly', name: 'Private feedback',
    body: "Hi {{customer_name}}, we'd love to hear how your {{service_name}} went at {{business_name}}. Your feedback helps us improve." },
  { id: 'feedback-professional', type: 'private_feedback', tone: 'professional', name: 'Private feedback - service check',
    body: 'Hello {{customer_name}}, how was your {{service_name}} at {{business_name}}? Reply here with any feedback - we read every message.' },

  { id: 'comeback-friendly', type: 'comeback_reminder', tone: 'friendly', name: 'Come back reminder',
    body: "Hi {{customer_name}}, it's been a while since your last {{service_name}} at {{business_name}}. Ready to book again?" },
  { id: 'comeback-casual', type: 'comeback_reminder', tone: 'casual', name: 'Come back - we miss you',
    body: "Hey {{customer_name}}, we miss you at {{business_name}}! Fancy booking your next {{service_name}}? Just reply here." },

  { id: 'inquiry-friendly', type: 'public_profile_inquiry', tone: 'friendly', name: 'New inquiry reply',
    body: "Hi {{customer_name}}, thanks for reaching out to {{business_name}} about your {{service_name}}! We'll get back to you shortly - feel free to call us at {{phone_number}} in the meantime." },

  { id: 'lead-friendly', type: 'lead_follow_up', tone: 'friendly', name: 'Lead follow-up',
    body: "Hi {{customer_name}}, just checking in from {{business_name}} about your {{service_name}} - still interested? Call us at {{phone_number}} or reply here." },
  { id: 'lead-professional', type: 'lead_follow_up', tone: 'professional', name: 'Lead follow-up - offer a time',
    body: 'Hello {{customer_name}}, following up from {{business_name}} about your {{service_name}}. Would you like us to reserve a time for you? Reply with what suits you.' },

  { id: 'custom-hello', type: 'custom', tone: 'friendly', name: 'General message',
    body: 'Hi {{customer_name}}, this is {{business_name}}.' },
  { id: 'custom-closed', type: 'custom', tone: 'professional', name: 'Holiday / closed notice',
    body: 'Hello {{customer_name}}, {{business_name}} will be closed on the upcoming public holiday. We reopen the next day - reply here to book ahead.' },
];

export function starterTemplatesFor(type?: MessageType): StarterTemplate[] {
  return type ? TEMPLATE_LIBRARY.filter((item) => item.type === type) : TEMPLATE_LIBRARY;
}
