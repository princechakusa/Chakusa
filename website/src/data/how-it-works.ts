// Product-truth ledger, same convention as data/product.ts: every claim
// below is checked against the actual backend modules and mobile feature
// flags. Automation and AI messaging describe themselves as owner-reviewed/
// assisted, never fully autonomous, because EXPO_PUBLIC_AUTOMATION_ENABLED
// is false in production. Real screenshots are used only where the image
// genuinely matches the step; steps without a matching production capture
// use an honest non-UI treatment instead of a fabricated screenshot.

export interface JourneyStage {
  id: string;
  number: string;
  label: string;
}

export const journeyStages: JourneyStage[] = [
  { id: "setup", number: "01", label: "Set up" },
  { id: "discover", number: "02", label: "Get discovered" },
  { id: "enquiry", number: "03", label: "Enquiry" },
  { id: "respond", number: "04", label: "Respond" },
  { id: "book", number: "05", label: "Book" },
  { id: "serve", number: "06", label: "Serve" },
  { id: "followup", number: "07", label: "Follow up" },
  { id: "review", number: "08", label: "Review" },
  { id: "return", number: "09", label: "Return" },
];

export interface JourneyStep {
  id: string;
  number: string;
  eyebrow: string;
  title: string;
  copy: string;
  points: string[];
  next: string;
  visual: string | null;
  visualLabel: string;
}

export const setupStep: JourneyStep = {
  id: "setup",
  number: "01",
  eyebrow: "Before the first customer",
  title: "Give Chakusa what it needs to represent your business.",
  copy: "Set up the business profile, services, team, and preferences once. Chakusa uses this information to support every conversation, booking, and follow-up that comes after.",
  points: ["Business profile", "Services", "Team members", "Notification preferences", "Message templates"],
  next: "With the business set up, customers can start finding it.",
  visual: null,
  visualLabel: "Business setup and account",
};

export const discoveryStep: JourneyStep = {
  id: "discover",
  number: "02",
  eyebrow: "Before the first conversation",
  title: "Customers can find the business and understand what it offers.",
  copy: "A public business profile and marketplace listing let a customer see the services, understand the business, and start a conversation, before a booking journey even begins.",
  points: ["Public business profile", "Marketplace listing", "Service categories", "Reviews visible to customers"],
  next: "Interest turns into an enquiry the business can see.",
  visual: null,
  visualLabel: "Marketplace and business profile",
};

export const enquiryStep: JourneyStep = {
  id: "enquiry",
  number: "03",
  eyebrow: "The moment interest arrives",
  title: "An enquiry becomes something the business can see and act on.",
  copy: "A missed call or a new conversation becomes a lead with customer details and service context attached, flagged for attention instead of sitting unseen.",
  points: ["Leads from missed calls and enquiries", "Customer details captured", "Needs-attention flagging", "Service context attached"],
  next: "The business responds while the enquiry is still fresh.",
  visual: null,
  visualLabel: "Leads and enquiries",
};

export const responseStep: JourneyStep = {
  id: "respond",
  number: "04",
  eyebrow: "Keep the conversation moving",
  title: "Prepare a response without losing the customer's context.",
  copy: "Chakusa can prepare a response using the business's own information, keeping the conversation and customer context together. A team member reviews and sends it, or takes the conversation over completely at any point.",
  points: ["Prepared responses", "AI-assisted drafting, owner-reviewed", "Full customer context", "Human takeover, always available"],
  next: "A clear conversation leads to a confirmed booking.",
  visual: "/images/product/chakusa-dashboard.png",
  visualLabel: "Response and follow-up actions",
};

export const bookingStep: JourneyStep = {
  id: "book",
  number: "05",
  eyebrow: "From conversation to appointment",
  title: "Turn interest into a confirmed visit.",
  copy: "Services, availability, and the team's calendar come together so a conversation becomes a clear appointment, with confirmation and reminders ahead of the visit.",
  points: ["Services and availability", "Calendar and scheduling", "Confirmation", "Rescheduling and cancellation"],
  next: "A confirmed booking starts the service itself.",
  visual: null,
  visualLabel: "Booking and calendar",
};

export const serviceStep = {
  id: "serve",
  number: "06",
  eyebrow: "Where Chakusa steps back",
  title: "The business does the work. Chakusa keeps the relationship around it.",
  copy: "The barber cuts hair. The dentist treats the patient. The mechanic repairs the car. The cleaner completes the job. Chakusa doesn't replace that work, it keeps the conversation, the booking, and the customer's history connected to it, before and after.",
};

export const followUpStep: JourneyStep = {
  id: "followup",
  number: "07",
  eyebrow: "After the visit",
  title: "The relationship doesn't end when the appointment does.",
  copy: "Every enquiry, booking, note, and outcome collects on one customer record, so a follow-up message or the next conversation starts with context instead of a blank slate.",
  points: ["Customer record and history", "Prepared follow-up messages", "Reminders", "Notes and preferences"],
  next: "A fresh visit is the right moment to ask for a review.",
  visual: null,
  visualLabel: "Customer records and history",
};

export const reviewStep: JourneyStep = {
  id: "review",
  number: "08",
  eyebrow: "Ask, always",
  title: "Request a review while the visit is still fresh.",
  copy: "Chakusa helps prepare a review request and collects private feedback alongside it, for every visit, not only the ones that went well. There is no gating: a review request is never withheld based on how the visit is expected to go.",
  points: ["Prepared review requests", "Private feedback, collected in parallel", "Request status tracking", "No sentiment gating"],
  next: "Feedback and history feed into knowing when the customer is due back.",
  visual: null,
  visualLabel: "Review and feedback requests",
};

export const returnStep: JourneyStep = {
  id: "return",
  number: "09",
  eyebrow: "Bring them back",
  title: "Know when a customer may be ready to return.",
  copy: "Chakusa surfaces customers who haven't rebooked in the expected window, so a reminder can go out while they're still a returning customer, not after they've quietly become a former one. Chakusa cannot promise a customer will rebook, it can only help the business notice the opportunity.",
  points: ["Customers due back", "Comeback reminders", "Repeat visit history", "No guaranteed outcomes"],
  next: "A returning customer restarts the journey from enquiry or booking.",
  visual: null,
  visualLabel: "Customers due back",
};

export const businessAttention = {
  eyebrow: "Every step, one view",
  title: "See what needs your attention, in one place.",
  copy: "Leads, bookings, reviews, and customers due back all surface in one working view, so the team can act on what's actually happening instead of checking five different tools.",
  points: ["Total customers and new customers this month", "Review requests sent and received", "Private feedback", "Recent activity across the whole journey"],
  visual: null,
  visualLabel: "Business dashboard and recent activity",
};

export const journeySteps: JourneyStep[] = [setupStep, discoveryStep, enquiryStep, responseStep, bookingStep];
export const journeyStepsAfterService: JourneyStep[] = [followUpStep, reviewStep, returnStep];

export const realWorldExample = {
  eyebrow: "Illustrative example",
  title: "One missed call, followed through.",
  copy: "A barbershop misses a call. Chakusa surfaces it as a lead that needs attention. The barber follows up, the customer books a haircut, and the appointment is completed. A review request goes out while the visit is fresh. Weeks later, Chakusa flags that the customer is due for another cut, and the business reaches out again.",
  disclaimer: "This is an illustrative walkthrough of how the product connects, not a measured customer result.",
};

export const connectedLoop = {
  eyebrow: "Not a funnel, a loop",
  title: "The relationship keeps going after the first visit.",
  copy: "A returning customer starts the journey again, at an enquiry, a booking, or straight into service. That's why Chakusa is built as a loop the relationship moves through, not a funnel that ends at the sale.",
  stages: ["Return customer", "Next enquiry or booking", "Service", "Follow-up", "Return again"],
};

export const howItWorksFaqs = [
  { question: "How do I get started with Chakusa?", answer: "Set up your business profile, services, and team, then customers can start finding and contacting the business through Chakusa." },
  { question: "How do customer enquiries enter Chakusa?", answer: "Missed calls and enquiries become leads with the customer's details and service context attached, flagged for attention." },
  { question: "Can customers book appointments through Chakusa?", answer: "Yes. Services, availability, and the calendar connect an enquiry to a confirmed appointment, with reminders ahead of the visit." },
  { question: "Does Chakusa send messages automatically?", answer: "Chakusa can prepare responses, reminders, and follow-ups using the business's information. Automation is owner-reviewed, and a team member can take over any conversation at any point." },
  { question: "How do review requests work?", answer: "Chakusa helps prepare a review request while the visit is still fresh and collects private feedback alongside it, for every visit. Requests are never withheld based on how a visit is expected to go." },
  { question: "How does Chakusa know when a customer may be due back?", answer: "Chakusa tracks each customer's visit history and surfaces a reminder when they haven't rebooked in the expected window. It cannot guarantee a customer returns." },
  { question: "Can I see everything that needs attention in one place?", answer: "Yes. The dashboard brings leads, bookings, reviews, and customers due back into one working view." },
  { question: "Does Chakusa work for different service businesses?", answer: "Yes. Barbers, salons, dentists, mechanics, cleaners, photographers, and similar local service businesses that rely on repeat customers." },
];
