import type { AppointmentDto } from '../apiTypes';

export interface AppointmentCommunicationEvent { key: string; label: string; sentAt: string; }

export function appointmentCommunicationEvents(appointment: AppointmentDto): AppointmentCommunicationEvent[] {
  const candidates: [string, string, string | null | undefined][] = [
    ['confirmation', 'Booking confirmation', appointment.confirmationSentAt],
    ['reminder', 'Upcoming appointment reminder', appointment.customerReminderSentAt],
    ['same_day', 'Same-day reminder', appointment.sameDayReminderSentAt],
    ['rescheduled', 'Reschedule confirmation', appointment.rescheduleConfirmationSentAt],
    ['canceled', 'Cancellation confirmation', appointment.cancellationConfirmationSentAt],
    ['follow_up', 'After-appointment follow-up', appointment.followUpSentAt],
    ['payment', 'Payment reminder', appointment.paymentReminderSentAt],
  ];
  return candidates.flatMap(([key, label, sentAt]) => sentAt ? [{ key, label, sentAt }] : []);
}
