// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION - Automation feature page.
// Structure reproduced from the Stitch export
// (chakusa_automation_practical_workflows_for_working_artisans/code.html):
// hero + proof strip, 4 everyday workflow cards, a "what the system
// creates" spotlight, pre-built workflow recipes by trade, final CTA.
//
// The core reframe, same as retention: Stitch's premise is workflows
// that send messages to customers automatically and "on autopilot."
// The real workflow engine (src/modules/automation/workflowTemplates.ts)
// has one action type - CREATE_TASK - meaning every workflow creates a
// task for a team member to review and act on; it does not message a
// customer on its own. EXPO_PUBLIC_AUTOMATION_ENABLED is false in
// mobile/eas.json. The four workflows below map to real template keys
// (MISSED_CALL_RECOVERY, APPOINTMENT_REMINDER, REVIEW_REQUEST,
// CUSTOMER_COMEBACK) with their real trigger events and delays, framed
// as "creates a task," never as an autonomous send.
//
// Fabricated content from the Stitch source removed, not replaced with
// different fabricated content:
// - "0 Complicated Builders / 4 Minutes One-Click Activation / 100%
//   On-Brand Automatic Messages" - replaced with the real facts.
// - Per-workflow fabricated stats ("21% All-Day Fills," "3.5-star
//   review increase," "35% recurring revenue uplift") and a specific
//   phone number and named text exchange ("Marcus L") - removed.
// - The "Dean Kowalski" testimonial with photo - a fabricated identity.
//   Removed, not replaced with a different fabricated one.
// - "Start 30-Day Business Trial" and "Put busywork on autopilot" -
//   the real trial is 14 days, not 30, and sending is never fully
//   autonomous; replaced.
export const automationHero = {
  badge: "Practical workflows",
  title: "Four workflows that flag the busywork, so your team doesn't have to remember it.",
  body: "Each workflow creates a task for your team when something needs attention: a missed call, an upcoming appointment, a finished job, a quiet regular. No workflow sends a message on its own.",
};

export const automationProof = [
  { label: "Setup", value: "No workflow builder needed" },
  { label: "Who sends messages", value: "Your team, always" },
  { label: "Included on", value: "Every plan" },
];

export interface Workflow { icon: string; badge: string; title: string; trigger: string; action: string; outcome: string }
export const workflows: Workflow[] = [
  { icon: "phone", badge: "Real template", title: "Missed Call Recovery", trigger: "A new lead comes in from a missed call or enquiry.", action: "Creates a follow-up task for your team about 5 hours later if it's still open.", outcome: "Fewer leads quietly going cold." },
  { icon: "calendar", badge: "Real template", title: "Appointment Reminder", trigger: "An appointment is booked on the calendar.", action: "Creates a task to review the upcoming appointment a day ahead.", outcome: "Fewer surprises the morning of a visit." },
  { icon: "star", badge: "Real template", title: "Review Request", trigger: "An appointment is marked complete.", action: "Creates a task to send a review request the next day.", outcome: "Review requests don't get forgotten in the rush." },
  { icon: "repeat", badge: "Real template", title: "Customer Comeback", trigger: "A customer hasn't been updated in a while.", action: "Creates a task about 30 business days out to plan outreach.", outcome: "Quiet regulars get noticed before they're gone." },
];

export const systemSpotlight = {
  label: "What automation actually creates",
  title: "A task for your team, not a message to your customer.",
  body: "Every workflow above ends the same way: a task appears in your dashboard with the context already attached. Nothing gets sent until someone on your team reviews it.",
  taskTitle: "Follow up with missed-call lead",
  taskMeta: "Created from: Missed Call Recovery",
};

export interface AutomationRecipe { icon: string; title: string; cadence: string; body: string }
export const automationRecipes: AutomationRecipe[] = [
  { icon: "car", title: "Auto & Independent Garages", cadence: "Mileage or seasonal", body: "Comeback tasks track service intervals instead of a flat calendar date." },
  { icon: "cut", title: "Salons & Barbers", cadence: "Every 3-4 weeks", body: "Comeback tasks follow typical chair-appointment cadence." },
  { icon: "home", title: "HVAC & Home Systems", cadence: "Seasonal", body: "Reminder tasks line up with pre-season maintenance windows." },
  { icon: "health", title: "Dental & Hygiene", cadence: "Every 6 months", body: "Comeback tasks follow a recall-based, not weekly, cadence." },
];

export const automationCta = {
  label: "Included on every plan",
  title: "Let Chakusa flag the busywork. Your team decides what happens next.",
  body: "Turn on the workflows that fit your business. No workflow builder, no coding, and nothing is ever sent without your team's review.",
};
