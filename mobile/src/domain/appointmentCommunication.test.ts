import { describe, expect, it } from 'vitest';
import type { AppointmentDto } from '../apiTypes';
import { appointmentCommunicationEvents } from './appointmentCommunication';

const appointment = (overrides: Partial<AppointmentDto> = {}): AppointmentDto => ({ id: 'a', businessId: 'b', customerId: 'c', assignedMemberId: null, serviceOfferingId: null, serviceName: 'Cut', startsAt: '', endsAt: '', status: 'CONFIRMED', price: null, notes: null, reminderMinutes: 60, createdAt: '', updatedAt: '', ...overrides });

describe('appointment communication events', () => {
  it('shows only persisted delivery evidence', () => expect(appointmentCommunicationEvents(appointment({ confirmationSentAt: '2026-01-01', sameDayReminderSentAt: '2026-01-02' }))).toEqual([
    { key: 'confirmation', label: 'Booking confirmation', sentAt: '2026-01-01' },
    { key: 'same_day', label: 'Same-day reminder', sentAt: '2026-01-02' },
  ]));
  it('does not invent pending or delivered messages', () => expect(appointmentCommunicationEvents(appointment())).toEqual([]));
});
