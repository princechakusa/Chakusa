export const stitchModules = [
  { label: "Overview Dashboard", href: "#workspace", icon: "tune" },
  { label: "Enquiries & Leads", href: "#enquiries", icon: "inbox", badge: "3 New" },
  { label: "Bookings Calendar", href: "#schedule", icon: "calendar_month" },
  { label: "Customer CRM", href: "#customer", icon: "account_box" },
  { label: "Reviews Engine", href: "#reviews", icon: "star_rate" },
  { label: "Retention Cadence", href: "#retention", icon: "repeat" },
  { label: "Quiet AI Settings", href: "#ai-settings", icon: "forum" },
];

export const stitchMetrics = [
  { label: "Bookings Today", value: "14", badge: "93% Capacity", note: "Next: 10:15 AM · Master Fade & Beard", icon: "event_available", tone: "teal" },
  { label: "Night AI Leads Handled", value: "3 In-Flight", badge: "$860 Value", note: "Converted past 10:00 PM without calls", icon: "forum", tone: "coral" },
  { label: "Retention Health", value: "86.4%", badge: "+4.2% MoM", note: "12 maintenance reminders sent today", icon: "repeat", tone: "teal" },
  { label: "Chakusa Verified Trust", value: "4.98 ★", badge: "342 Verified", note: "Zero dispute incidence in 180 days", icon: "star_rate", tone: "neutral" },
];

export const stitchLeads = [
  { name: "Marcus Vance", service: "Ceramic Studio / Private Workshop", message: '"Looking to book a private wheel-throwing session for 4 people next Friday night."', time: "10:48 PM (AI Captured)", state: "Slot Held 24h", action: "1-Click Confirm", secondary: "View Chat", tone: "coral" },
  { name: "Elena Rostova", service: "Custom Glaze Consultation", message: '"Need 24 dinnerware pieces tailored in terracotta matte for opening in late June."', time: "11:32 PM (AI Captured)", state: "Estimate Attached", action: "Send Contract", secondary: "Details", tone: "teal" },
  { name: "Julian Sterling", service: "Weekend Studio Rental", message: '"Checking kiln availability for 6 bisque firing shelves this Saturday."', time: "01:14 AM (AI Handled)", state: "Booking Link Sent", action: "Review Slot", secondary: "Reschedule", tone: "slate" },
];

export const stitchSchedule = [
  { time: "09:00", period: "AM", title: "Bespoke Wheel Throwing 1-on-1", detail: "Client: Michael Cheng · Studio Bench 02", status: "Completed", tone: "complete" },
  { time: "11:30", period: "AM", title: "Intermediate Ceramic Glaze Workshop (Group of 6)", detail: "Main Kiln & Glazing Bay · $480 Paid", status: "In Progress", tone: "progress" },
  { time: "02:15", period: "PM", title: "Commercial Clay Supply Prep & Firing Cycle", detail: "Kiln Room C · Sarah Jenkins (Lead Artisan)", status: "Upcoming", tone: "upcoming" },
];

export const stitchReviews = [
  { name: "Rachel Thorne", body: '"The automated reminder popped up right when my pottery piece was fired and cured. Picking up was seamless and the pieces are absolute art!"', meta: "2 hours ago · Verified Studio Customer" },
  { name: "Marcus Campbell", body: '"Messaged the shop late Sunday night expecting a Monday reply. Chakusa\'s AI responded in 20 seconds with available wheels, and I was booked instantly."', meta: "Yesterday · Verified Workshop Guest" },
];

export const stitchConversion = [
  { number: "01", title: "Inquiry Ingestion", body: "Customer sends a message or calls at 10:45 PM. Chakusa's quiet intake system listens, transcribes, and extracts scope of work.", signal: 'Incoming: "Need studio workshop for 4 next weekend..."', tone: "coral" },
  { number: "02", title: "Zero-Lag Politeness", body: "Within 30 seconds, an automated, tailored response arrives with exact pricing and a direct scheduling reservation link.", signal: "Dispatch: Link sent via SMS & Web Chat", tone: "teal" },
  { number: "03", title: "Customer Self-Books", body: "The client opens the slot calendar over their morning coffee at 7:15 AM, selects their preference, and pays deposit fees upfront.", signal: "Status: Slot confirmed & Stripe deposit captured", tone: "slate" },
  { number: "04", title: "Ready on Wakeup", body: "You open your shop morning routine: the schedule is balanced, prep notes are pre-filled, and no voicemail needed transcribing.", signal: "Calendar synced: Bench 2 assigned", tone: "solid" },
];

export const stitchCadences = [
  { icon: "spa", title: "Ceramic Studio Class Repack", interval: "4 to 6 Weeks", detail: "Automated glazing invite sent at Day 28", result: "82% Rebook Rate", progress: "82%", tone: "coral" },
  { icon: "content_cut", title: "Barber & Salon Regulars", interval: "3 Weeks", detail: '"Your usual Thursday with Leo?" prompt', result: "91% Rebook Rate", progress: "91%", tone: "teal" },
  { icon: "car_repair", title: "Auto Diagnostics & Tires", interval: "6 Months", detail: "Mileage-adjusted safety reminder prompt", result: "74% Rebook Rate", progress: "74%", tone: "slate" },
];

export const stitchAssistantSettings = [
  { title: "Knowledge Base Anchor", state: "Synced 12m ago", body: "Services menu, pricing sheet, cancellation cutoffs, and parking access instructions.", note: "Strict Constraint Mode (No improvised discounts)" },
  { title: "Human Escalation Trigger", state: "Immediate SMS Alert", body: "When client requests custom commercial contracts exceeding $1,000, AI gently defers to owner direct call." },
  { title: "Tone of Voice Calibration", state: "Warm Artisan & Precise", body: "Mirrors your warm, local studio tone without sounding like an unfeeling bot." },
];
