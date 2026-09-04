export const businessModules = [
  { label: "Overview", href: "#workspace", icon: "tune" },
  { label: "Enquiries", href: "/features/enquiries", icon: "inbox" },
  { label: "Bookings", href: "/features/bookings", icon: "calendar_month" },
  { label: "Customers", href: "/features/customers", icon: "account_box" },
  { label: "Reviews", href: "/features/reviews", icon: "star_rate" },
  { label: "Retention", href: "/features/customer-retention", icon: "repeat" },
  { label: "AI assistant", href: "/features/ai-assistant", icon: "forum" },
];

export const businessCapabilities = [
  {
    icon: "inbox",
    eyebrow: "Enquiries and leads",
    title: "Keep every new customer request visible.",
    body: "Missed calls and enquiries reach one attention queue with the customer, service, and timing attached.",
    href: "/features/enquiries",
  },
  {
    icon: "calendar_month",
    eyebrow: "Bookings and calendar",
    title: "Turn interest into a clear appointment.",
    body: "Services, availability, booking rules, and the working calendar stay connected for the whole team.",
    href: "/features/bookings",
  },
  {
    icon: "account_box",
    eyebrow: "Customer records",
    title: "Start the next conversation with context.",
    body: "Enquiries, bookings, notes, and outcomes collect on one customer record instead of disappearing across tools.",
    href: "/features/customers",
  },
  {
    icon: "star_rate",
    eyebrow: "Reviews and feedback",
    title: "Ask every customer while the visit is fresh.",
    body: "Review requests and private feedback follow a completed visit without filtering customers by expected rating.",
    href: "/features/reviews",
  },
];

export const businessFlow = [
  { number: "01", icon: "contact_phone", title: "Enquiry arrives", body: "The request and customer details become visible to the business." },
  { number: "02", icon: "forum", title: "Response is prepared", body: "Chakusa can prepare a reply for the team to review and send." },
  { number: "03", icon: "event_available", title: "Customer books", body: "Available services and times turn the conversation into a visit." },
  { number: "04", icon: "repeat", title: "Relationship continues", body: "Reviews, feedback, and due-back reminders keep the next step visible." },
];

export const retentionItems = [
  { title: "Rebooking window", detail: "Set by the business for each service", state: "Business controlled" },
  { title: "Customer becomes due", detail: "Chakusa surfaces the customer for attention", state: "Visible to the team" },
  { title: "Reminder prepared", detail: "The team reviews the message before it goes out", state: "Human reviewed" },
];

export const assistantControls = [
  { title: "Business knowledge", body: "Services, prices, hours, policies, and approved business information guide each draft." },
  { title: "Approval mode", body: "Draft mode keeps the team in control. A person can review, edit, send, or take over." },
  { title: "Escalation", body: "Questions outside the available business information are handed to a team member." },
];
