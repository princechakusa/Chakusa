import { describe, expect, it } from 'vitest';
import type { AvailabilitySlotDto, BookableServiceDto, CustomerBookingDto } from '../apiTypes';
import {
  bookingActions,
  bookingCalendarGrid,
  bookingStatusLabel,
  bookingStepLabel,
  canAdvanceFrom,
  canNavigateBooking,
  currentBookingStep,
  emptyDraft,
  formatServiceMeta,
  groupSlotsByDay,
  isBookingDraftComplete,
  isOutOfScopeRoute,
  nextBooking,
  partitionBookings,
  receiptLines,
  reminderStatusLabel,
  slotsForStaff,
  staffOptions,
} from './booking';

const slot = (startsAt: string, members: Array<{ id: string; name: string }>): AvailabilitySlotDto => ({
  startsAt,
  endsAt: new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(),
  members,
});

const booking = (over: Partial<CustomerBookingDto> = {}): CustomerBookingDto => ({
  id: over.id ?? 'b1',
  status: over.status ?? 'CONFIRMED',
  serviceName: 'Haircut',
  serviceId: 's1',
  category: null,
  startsAt: over.startsAt ?? '2026-09-10T10:00:00.000Z',
  endsAt: over.endsAt ?? '2026-09-10T11:00:00.000Z',
  notes: null,
  staffName: over.staffName ?? 'Sam',
  price: over.price ?? 40,
  paidAmount: 0,
  paymentStatus: 'unpaid',
  bookingChannel: 'customer_app',
  reminder: over.reminder ?? { minutesBefore: 1440, reminderSent: false, sameDayReminderSent: false },
  canReschedule: true,
  canCancel: true,
  cancellationCutoff: over.cancellationCutoff ?? '2026-09-10T09:00:00.000Z',
  business: { id: 'biz', name: 'Salon', slug: 'salon', timezone: 'UTC', currency: null, phone: null },
  ...over,
});

describe('booking domain (Program 2, Loop 3)', () => {
  describe('navigation — no payments/loyalty/rewards', () => {
    it('allows the four booking routes', () => {
      for (const route of ['BookingFlow', 'BookingCalendar', 'AppointmentDetails', 'BookingHistory']) {
        expect(canNavigateBooking(route)).toBe(true);
      }
    });
    it('rejects out-of-scope routes', () => {
      for (const route of ['Payment', 'Checkout', 'LoyaltyHome', 'Rewards', 'MembershipTiers', 'ReferralInvite', 'Wallet']) {
        expect(isOutOfScopeRoute(route)).toBe(true);
        expect(canNavigateBooking(route)).toBe(false);
      }
    });
  });

  describe('flow state machine', () => {
    it('walks service -> staff -> date -> time -> confirm', () => {
      let draft = { ...emptyDraft };
      expect(currentBookingStep(draft)).toBe('service');
      draft = { ...draft, serviceId: 's1' };
      expect(currentBookingStep(draft)).toBe('staff');
      draft = { ...draft, staffId: 'any' };
      expect(currentBookingStep(draft)).toBe('date');
      draft = { ...draft, date: '2026-09-10' };
      expect(currentBookingStep(draft)).toBe('time');
      draft = { ...draft, startsAt: '2026-09-10T10:00:00.000Z' };
      expect(currentBookingStep(draft)).toBe('confirm');
      expect(isBookingDraftComplete(draft)).toBe(true);
    });
    it('gates advancement per step', () => {
      expect(canAdvanceFrom('service', emptyDraft)).toBe(false);
      expect(canAdvanceFrom('staff', { ...emptyDraft, serviceId: 's1', staffId: null })).toBe(false);
      expect(canAdvanceFrom('staff', { ...emptyDraft, serviceId: 's1', staffId: 'any' })).toBe(true);
    });
    it('labels steps', () => {
      expect(bookingStepLabel('time')).toBe('Choose a time');
    });
  });

  describe('services & slots', () => {
    it('formats service meta with currency', () => {
      const service: BookableServiceDto = { id: 's', name: 'Cut', description: null, category: null, durationMinutes: 45, price: 30, depositAmount: 10 };
      expect(formatServiceMeta(service, '£')).toBe('45 min · £30 · £10 deposit');
    });
    it('groups slots by local day and filters by staff', () => {
      const slots = [
        slot('2026-09-10T09:00:00.000Z', [{ id: 'm1', name: 'Sam' }]),
        slot('2026-09-10T15:00:00.000Z', [{ id: 'm2', name: 'Alex' }]),
        slot('2026-09-11T09:00:00.000Z', [{ id: 'm1', name: 'Sam' }, { id: 'm2', name: 'Alex' }]),
      ];
      const groups = groupSlotsByDay(slots, 'UTC');
      expect(groups.map((g) => g.day)).toEqual(['2026-09-10', '2026-09-11']);
      expect(groups[0].slots).toHaveLength(2);
      expect(slotsForStaff(slots, 'm2').map((s) => s.startsAt)).toEqual(['2026-09-10T15:00:00.000Z', '2026-09-11T09:00:00.000Z']);
      expect(slotsForStaff(slots, 'any')).toHaveLength(3);
      expect(staffOptions(slots).map((s) => s.name)).toEqual(['Alex', 'Sam']);
    });
  });

  describe('calendar & history', () => {
    it('partitions upcoming vs past and finds the next booking', () => {
      const now = new Date('2026-09-01T00:00:00.000Z');
      const list = [
        booking({ id: 'future', startsAt: '2026-09-10T10:00:00.000Z', status: 'CONFIRMED' }),
        booking({ id: 'soon', startsAt: '2026-09-05T10:00:00.000Z', status: 'SCHEDULED' }),
        booking({ id: 'done', startsAt: '2026-08-20T10:00:00.000Z', status: 'COMPLETED' }),
        booking({ id: 'cancelled-future', startsAt: '2026-09-12T10:00:00.000Z', status: 'CANCELED' }),
      ];
      const { upcoming, past } = partitionBookings(list, now);
      expect(upcoming.map((b) => b.id)).toEqual(['soon', 'future']);
      expect(past.map((b) => b.id)).toEqual(['cancelled-future', 'done']);
      expect(nextBooking(list, now)?.id).toBe('soon');
    });

    it('mirrors the server reschedule/cancel guard', () => {
      const before = new Date('2026-09-10T08:00:00.000Z');
      const after = new Date('2026-09-10T09:30:00.000Z');
      expect(bookingActions(booking(), before)).toEqual({ canReschedule: true, canCancel: true, reason: null });
      expect(bookingActions(booking(), after).canCancel).toBe(false);
      expect(bookingActions(booking({ status: 'COMPLETED' }), before).canReschedule).toBe(false);
    });

    it('labels reminder and status', () => {
      expect(reminderStatusLabel({ minutesBefore: 1440, reminderSent: false, sameDayReminderSent: false })).toBe('Reminder 24h before');
      expect(reminderStatusLabel({ minutesBefore: 1440, reminderSent: true, sameDayReminderSent: false })).toBe('Reminder sent');
      expect(bookingStatusLabel('NO_SHOW')).toBe('Missed');
    });

    it('builds a Monday-first month grid with booking counts', () => {
      const grid = bookingCalendarGrid(2026, 9, [booking({ startsAt: '2026-09-10T10:00:00.000Z' }), booking({ startsAt: '2026-09-10T14:00:00.000Z' })], 'UTC');
      expect(grid).toHaveLength(42);
      expect(grid[0].date).toBe('2026-08-31'); // Monday before Sep 1 (a Tuesday)
      const tenth = grid.find((c) => c.date === '2026-09-10');
      expect(tenth).toMatchObject({ inMonth: true, count: 2 });
    });
  });

  describe('receipt', () => {
    it('renders reference, business, service, time and staff', () => {
      const lines = receiptLines({ reference: 'ABCD1234', businessName: 'Salon', service: 'Haircut', staff: 'Sam', startsAt: '2026-09-10T10:00:00.000Z', endsAt: '2026-09-10T11:00:00.000Z', status: 'SCHEDULED', price: 40, depositAmount: null, currency: '£' }, 'UTC');
      expect(lines[0]).toBe('Ref ABCD1234');
      expect(lines).toContain('With Sam');
      expect(lines).toContain('£40');
    });
  });
});
