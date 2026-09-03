export const bookingExample = {
  locale: "en",
  currency: "AED",
  business: "Harbour Studio",
  customer: "Amina S.",
  teamMember: "Leila N.",
  service: "Signature appointment",
  duration: "45 min",
  price: "AED 180",
  date: "24 October",
  selectedTime: "3:30 PM",
  times: ["2:00 PM", "2:45 PM", "3:30 PM"],
  schedule: [
    { time: "2:30 PM", customer: "Nora K.", service: "Consultation", status: "Completed" },
    { time: "3:30 PM", customer: "Amina S.", service: "Signature appointment", status: "Confirmed" },
    { time: "4:30 PM", customer: "Sam R.", service: "Follow-up visit", status: "Scheduled" },
  ],
};

export const bookingIndustries = [
  { icon: "cut", title: "Salons and stylists", copy: "Set service duration, team availability, and preparation time for each appointment.", points: ["Service-specific duration", "Team member selection"], example: "Colour consultation, 60 min" },
  { icon: "health", title: "Dental and clinics", copy: "Offer clear appointment windows while keeping working hours and existing bookings protected.", points: ["Business-hour availability", "Appointment change windows"], example: "Routine appointment, 30 min" },
  { icon: "travel", title: "Mobile services", copy: "Use availability blocks and assigned team members to keep field schedules clear.", points: ["Team availability", "Calendar blocks"], example: "On-site service, 90 min" },
  { icon: "fitness", title: "Studios and fitness", copy: "Publish bookable services with predictable durations and customer confirmations.", points: ["Bookable services", "Customer reminders"], example: "Private session, 45 min" },
];
