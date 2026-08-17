// Matches mobile/src/screens/OnboardingScreen.tsx's industry picker exactly.
// Do not add a category that isn't offered at signup. Ordered by real
// message-template depth (src/lib/defaultTemplates.ts currently has
// industry-specific templates only for barber, dentist, and restaurant),
// per docs/WEBSITE_CREATIVE_DIRECTION.md Part 6.

export interface Industry {
  id: string;
  title: string;
  examples: string[];
  copy: string;
  /** 3 concrete, honest examples of what Chakusa tracks for this vertical ,
   * every line must map to a real feature (Lead, ReviewRequest, Reminder),
   * never an automation claim beyond what's actually live. */
  workflow: string[];
}

export const industries: Industry[] = [
  {
    id: "beauty",
    title: "Beauty",
    examples: ["Salon", "Barber", "Beauty clinic", "Spa"],
    copy: "Missed a walk-in call, or a client who hasn't rebooked their usual cut or color? Chakusa tracks both without you having to remember.",
    workflow: [
      "A missed call from a new client becomes a lead you can follow up with",
      "Send a review request right after a cut, color, or treatment",
      "See who's overdue for their usual appointment before they book elsewhere",
    ],
  },
  {
    id: "professional",
    title: "Professional",
    examples: ["Dentist", "Photographer", "Consultant", "Other"],
    copy: "A missed appointment call or a patient overdue for a check-up shouldn't slip through. Chakusa keeps both visible.",
    workflow: [
      "Track every missed booking call as a lead, not a lost message",
      "Ask for a review once a session or appointment wraps up",
      "Know who's due for a check-up, follow-up, or repeat booking",
    ],
  },
  {
    id: "home-services",
    title: "Home services",
    examples: ["Plumber", "Electrician", "Cleaner", "Contractor"],
    copy: "Between jobs, a missed call is a missed job. Chakusa tracks it as a lead the moment it happens.",
    workflow: [
      "A missed call while you're on a job still becomes a trackable lead",
      "Request a review once the job's done, while it's still fresh",
      "Get a reminder when a regular client is due for their next service",
    ],
  },
  {
    id: "automotive",
    title: "Automotive",
    examples: ["Mechanic", "Car wash", "Detailing"],
    copy: "Track every inquiry, ask for a review after the work is done, and know who's due back for their next service.",
    workflow: [
      "Every missed inquiry call is tracked as a lead, not forgotten",
      "Ask for a review after the work is picked up",
      "See who's due back for a seasonal check or routine service",
    ],
  },
];
