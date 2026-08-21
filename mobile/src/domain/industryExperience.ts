import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

type IndustryIcon = ComponentProps<typeof Ionicons>['name'];
export interface IndustryExperience { id: string; label: string; category: string; icon: IndustryIcon; services: string[]; dashboardLabel: string; emptyLeadCopy: string; }

export const INDUSTRY_EXPERIENCES: IndustryExperience[] = [
  { id: 'barber', label: 'Barber', category: 'Beauty & wellness', icon: 'cut-outline', services: ['Haircut', 'Beard trim', 'Hot towel shave', 'Hair coloring'], dashboardLabel: 'Today’s chair', emptyLeadCopy: 'Add a customer follow-up after a missed booking call.' },
  { id: 'hair_salon', label: 'Hair salon', category: 'Beauty & wellness', icon: 'color-palette-outline', services: ['Haircut', 'Hair coloring', 'Blow dry', 'Treatment'], dashboardLabel: 'Today’s appointments', emptyLeadCopy: 'Keep every styling enquiry moving forward.' },
  { id: 'beauty_salon', label: 'Beauty salon', category: 'Beauty & wellness', icon: 'sparkles-outline', services: ['Facial', 'Manicure', 'Pedicure', 'Waxing'], dashboardLabel: 'Today’s bookings', emptyLeadCopy: 'Follow up with guests who are ready to book.' },
  { id: 'dentist', label: 'Dentist', category: 'Care', icon: 'medical-outline', services: ['Consultation', 'Cleaning', 'Check-up', 'Treatment'], dashboardLabel: 'Patient follow-up', emptyLeadCopy: 'Keep patient enquiries from going cold.' },
  { id: 'spa', label: 'Spa', category: 'Beauty & wellness', icon: 'leaf-outline', services: ['Massage', 'Facial', 'Body treatment', 'Spa day'], dashboardLabel: 'Guest recovery', emptyLeadCopy: 'Invite guests back when they are ready to unwind.' },
  { id: 'gym', label: 'Gym', category: 'Care', icon: 'barbell-outline', services: ['Membership', 'Personal training', 'Class pass', 'Consultation'], dashboardLabel: 'Member momentum', emptyLeadCopy: 'Help prospective members take their next step.' },
  { id: 'restaurant', label: 'Restaurant', category: 'Hospitality', icon: 'restaurant-outline', services: ['Reservation', 'Takeaway', 'Catering', 'Private event'], dashboardLabel: 'Guest activity', emptyLeadCopy: 'Respond to guests before they choose another table.' },
  { id: 'mechanic', label: 'Mechanic', category: 'Automotive', icon: 'car-sport-outline', services: ['Service', 'Repair', 'Diagnostics', 'Tyres'], dashboardLabel: 'Workshop recovery', emptyLeadCopy: 'Follow up on repair enquiries while the need is urgent.' },
  { id: 'cleaning', label: 'Cleaning', category: 'Home services', icon: 'sparkles-outline', services: ['Home cleaning', 'Deep clean', 'Office cleaning', 'Move-out clean'], dashboardLabel: 'Job recovery', emptyLeadCopy: 'Turn every cleaning enquiry into a confirmed job.' },
  { id: 'electrician', label: 'Electrician', category: 'Home services', icon: 'flash-outline', services: ['Electrical repair', 'Installation', 'Inspection', 'Emergency callout'], dashboardLabel: 'Job recovery', emptyLeadCopy: 'Prioritize customers who need help now.' },
  { id: 'photographer', label: 'Photographer', category: 'Professional', icon: 'camera-outline', services: ['Portrait session', 'Event coverage', 'Wedding', 'Editing'], dashboardLabel: 'Enquiry pipeline', emptyLeadCopy: 'Follow up before a potential client books elsewhere.' },
  { id: 'car_wash', label: 'Car wash', category: 'Automotive', icon: 'water-outline', services: ['Wash', 'Detailing', 'Interior clean', 'Ceramic coating'], dashboardLabel: 'Customer return', emptyLeadCopy: 'Bring drivers back before their next wash is overdue.' },
  { id: 'pet_grooming', label: 'Pet grooming', category: 'Care', icon: 'paw-outline', services: ['Grooming', 'Bath', 'Nail trim', 'De-shedding'], dashboardLabel: 'Pet parent follow-up', emptyLeadCopy: 'Make it easy for pet parents to book again.' },
  { id: 'veterinary', label: 'Veterinary', category: 'Care', icon: 'medkit-outline', services: ['Consultation', 'Vaccination', 'Check-up', 'Treatment'], dashboardLabel: 'Patient care', emptyLeadCopy: 'Keep pet-care enquiries from being missed.' },
  { id: 'moving_company', label: 'Moving company', category: 'Home services', icon: 'cube-outline', services: ['Home move', 'Office move', 'Packing', 'Storage'], dashboardLabel: 'Move enquiries', emptyLeadCopy: 'Reply quickly while customers are planning their move.' },
  { id: 'plumber', label: 'Plumber', category: 'Home services', icon: 'construct-outline', services: ['Plumbing repair', 'Installation', 'Drain cleaning', 'Emergency callout'], dashboardLabel: 'Job recovery', emptyLeadCopy: 'Respond while the customer’s issue still needs solving.' },
  { id: 'hvac', label: 'HVAC', category: 'Home services', icon: 'thermometer-outline', services: ['Repair', 'Installation', 'Maintenance', 'Emergency callout'], dashboardLabel: 'Service recovery', emptyLeadCopy: 'Make urgent service follow-up effortless.' },
  { id: 'home_services', label: 'Home services', category: 'Home services', icon: 'home-outline', services: ['Consultation', 'Repair', 'Installation', 'Maintenance'], dashboardLabel: 'Job recovery', emptyLeadCopy: 'Keep every home-service enquiry moving.' },
];

export function industryExperience(id: string | null | undefined) { return INDUSTRY_EXPERIENCES.find(item => item.id === id) ?? null; }
