import { PublicBusinessProfileDetails } from '../domain/publicBusinessProfile';
import { API_URL } from '../config';
import { api } from './api';

const pathFor = (slug: string) => `/public/business/${encodeURIComponent(slug)}`;

export interface SubmitPublicContactInput {
  name: string;
  phone: string;
  serviceRequested?: string;
  message?: string;
  ref?: string;
}
export interface PublicAvailabilitySlot { startsAt: string; endsAt: string; members: { id: string; name: string }[]; }
export interface CreatePublicBookingInput { serviceOfferingId: string; assignedMemberId: string; startsAt: string; name: string; phone: string; email?: string; notes?: string; }
export interface PublicBookingDetails { id: string; serviceName: string; startsAt: string; endsAt: string; status: 'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'NO_SHOW'; business: { name: string; cancellationNoticeMinutes: number }; serviceOffering: { id: string; durationMinutes: number } | null; assignedMember: { id: string; user: { fullName: string } } | null; }

export const publicBusinessProfileApi = {
  get: (slug: string) => api.get<PublicBusinessProfileDetails>(pathFor(slug), 'none'),
  submitContact: (slug: string, input: SubmitPublicContactInput) =>
    api.post<{ state: 'submitted'; businessName: string }>(`${pathFor(slug)}/contact`, input, 'none'),
  availability: (slug: string, serviceOfferingId: string, from: string, to: string) => api.get<PublicAvailabilitySlot[]>(`${pathFor(slug)}/availability?serviceOfferingId=${encodeURIComponent(serviceOfferingId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, 'none'),
  book: (slug: string, input: CreatePublicBookingInput) => api.post<{ businessName: string; appointment: { id: string; serviceName: string; startsAt: string; endsAt: string }; managementToken: string }>(`${pathFor(slug)}/book`, input, 'none'),
  getBooking: (slug: string, token: string) => api.get<PublicBookingDetails>(`${pathFor(slug)}/bookings/${encodeURIComponent(token)}`, 'none'),
  cancelBooking: (slug: string, token: string) => api.post<PublicBookingDetails>(`${pathFor(slug)}/bookings/${encodeURIComponent(token)}/cancel`, {}, 'none'),
  confirmBooking: (slug: string, token: string) => api.post<PublicBookingDetails>(`${pathFor(slug)}/bookings/${encodeURIComponent(token)}/confirm`, {}, 'none'),
  rescheduleBooking: (slug: string, token: string, input: { assignedMemberId: string; startsAt: string }) => api.post<PublicBookingDetails>(`${pathFor(slug)}/bookings/${encodeURIComponent(token)}/reschedule`, input, 'none'),
  calendarUrl: (slug: string, token: string) => `${API_URL}${pathFor(slug)}/bookings/${encodeURIComponent(token)}/calendar.ics`,
};
