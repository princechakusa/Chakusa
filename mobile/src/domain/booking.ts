import type { AvailabilitySlotDto, BookableServiceDto, CustomerBookingDto } from '../apiTypes';

// PROGRAM 2 LOOP 3: pure product rules for the customer booking & calendar
// mobile experience — the choose-service -> choose-staff -> choose-date ->
// choose-time -> confirm flow, the calendar/history split, and
// reschedule/cancel eligibility. No payment, loyalty, membership or rewards
// logic (explicitly out of scope for this loop).

// --- Navigation --------------------------------------------------------------

export type BookingRoute = 'BookingFlow' | 'BookingCalendar' | 'AppointmentDetails' | 'BookingHistory';
export const BOOKING_ROUTES: readonly BookingRoute[] = ['BookingFlow', 'BookingCalendar', 'AppointmentDetails', 'BookingHistory'];

/** Payment / loyalty / rewards destinations are out of scope this loop and must stay unreachable. */
export function isOutOfScopeRoute(route: string): boolean {
  return /^(Payment|Pay|Checkout|Loyalty|Rewards|Membership|Referral|Points|Wallet)/i.test(route);
}
export function canNavigateBooking(route: string): route is BookingRoute {
  return (BOOKING_ROUTES as readonly string[]).includes(route) && !isOutOfScopeRoute(route);
}

// --- Booking flow state machine -------------------------------------------

export type BookingStep = 'service' | 'staff' | 'date' | 'time' | 'confirm';
export const BOOKING_STEPS: readonly BookingStep[] = ['service', 'staff', 'date', 'time', 'confirm'];

export interface BookingDraft {
  serviceId: string | null;
  staffId: string | null | 'any';
  date: string | null; // YYYY-MM-DD
  startsAt: string | null; // ISO
}

export const emptyDraft: BookingDraft = { serviceId: null, staffId: null, date: null, startsAt: null };

/** The first step that is not yet satisfied — where the wizard should sit. */
export function currentBookingStep(draft: BookingDraft): BookingStep {
  if (!draft.serviceId) return 'service';
  if (draft.staffId === null) return 'staff';
  if (!draft.date) return 'date';
  if (!draft.startsAt) return 'time';
  return 'confirm';
}

export function isBookingDraftComplete(draft: BookingDraft): boolean {
  return currentBookingStep(draft) === 'confirm';
}

export function canAdvanceFrom(step: BookingStep, draft: BookingDraft): boolean {
  switch (step) {
    case 'service': return Boolean(draft.serviceId);
    case 'staff': return draft.staffId !== null;
    case 'date': return Boolean(draft.date);
    case 'time': return Boolean(draft.startsAt);
    case 'confirm': return isBookingDraftComplete(draft);
  }
}

export function bookingStepLabel(step: BookingStep): string {
  return { service: 'Choose a service', staff: 'Choose staff', date: 'Choose a date', time: 'Choose a time', confirm: 'Confirm booking' }[step];
}

// --- Service display -----------------------------------------------------

export function formatServiceMeta(service: BookableServiceDto, currency = ''): string {
  const parts = [`${service.durationMinutes} min`];
  if (service.price != null) parts.push(`${currency}${service.price}`.trim());
  if (service.depositAmount != null) parts.push(`${currency}${service.depositAmount} deposit`.trim());
  return parts.join(' · ');
}

// --- Slots -------------------------------------------------------------------

export function localDayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function formatSlotTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export interface SlotDayGroup {
  day: string;
  slots: AvailabilitySlotDto[];
}

/** Groups availability slots by local calendar day, chronologically. */
export function groupSlotsByDay(slots: AvailabilitySlotDto[], timeZone: string): SlotDayGroup[] {
  const byDay = new Map<string, AvailabilitySlotDto[]>();
  for (const slot of [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = localDayKey(slot.startsAt, timeZone);
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(slot);
  }
  return [...byDay.entries()].map(([day, daySlots]) => ({ day, slots: daySlots }));
}

/** Slots on one day, filtered to a chosen staff member (or all when 'any'). */
export function slotsForStaff(slots: AvailabilitySlotDto[], staffId: string | 'any'): AvailabilitySlotDto[] {
  if (staffId === 'any') return slots;
  return slots.filter((slot) => slot.members.some((member) => member.id === staffId));
}

export function staffOptions(slots: AvailabilitySlotDto[]): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const slot of slots) for (const member of slot.members) if (!seen.has(member.id)) seen.set(member.id, member.name);
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// --- Calendar / history ------------------------------------------------

const OPEN_STATUSES = ['SCHEDULED', 'CONFIRMED'];

export interface BookingPartition {
  upcoming: CustomerBookingDto[];
  past: CustomerBookingDto[];
}

/** Splits a mixed list into upcoming (open & future) and past, each sorted sensibly. */
export function partitionBookings(bookings: CustomerBookingDto[], now: Date = new Date()): BookingPartition {
  const upcoming: CustomerBookingDto[] = [];
  const past: CustomerBookingDto[] = [];
  for (const booking of bookings) {
    const future = new Date(booking.startsAt).getTime() >= now.getTime();
    if (future && OPEN_STATUSES.includes(booking.status)) upcoming.push(booking);
    else past.push(booking);
  }
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  past.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { upcoming, past };
}

export function nextBooking(bookings: CustomerBookingDto[], now: Date = new Date()): CustomerBookingDto | null {
  return partitionBookings(bookings, now).upcoming[0] ?? null;
}

export type BookingActionAvailability = { canReschedule: boolean; canCancel: boolean; reason: string | null };

/** Mirrors the server guard: open status AND before the cancellation-notice cutoff. */
export function bookingActions(booking: Pick<CustomerBookingDto, 'status' | 'cancellationCutoff'>, now: Date = new Date()): BookingActionAvailability {
  if (!OPEN_STATUSES.includes(booking.status)) return { canReschedule: false, canCancel: false, reason: 'This booking is closed.' };
  if (now.getTime() >= new Date(booking.cancellationCutoff).getTime()) {
    return { canReschedule: false, canCancel: false, reason: 'Too close to the appointment — contact the business.' };
  }
  return { canReschedule: true, canCancel: true, reason: null };
}

export function reminderStatusLabel(reminder: CustomerBookingDto['reminder']): string {
  if (reminder.sameDayReminderSent) return 'Same-day reminder sent';
  if (reminder.reminderSent) return 'Reminder sent';
  if (reminder.minutesBefore == null) return 'No reminder set';
  const hours = Math.round(reminder.minutesBefore / 60);
  return hours >= 1 ? `Reminder ${hours}h before` : `Reminder ${reminder.minutesBefore}m before`;
}

export function bookingStatusLabel(status: CustomerBookingDto['status']): string {
  return { SCHEDULED: 'Scheduled', CONFIRMED: 'Confirmed', COMPLETED: 'Completed', CANCELED: 'Canceled', NO_SHOW: 'Missed' }[status];
}

// --- Month calendar grid -----------------------------------------------

export interface CalendarCell {
  date: string; // YYYY-MM-DD
  inMonth: boolean;
  count: number;
}

/** A Monday-first 6x7 grid for `year`-`month` (1-12), annotated with booking counts per day. */
export function bookingCalendarGrid(year: number, month: number, bookings: CustomerBookingDto[], timeZone = 'UTC'): CalendarCell[] {
  const counts = new Map<string, number>();
  for (const booking of bookings) {
    const key = localDayKey(booking.startsAt, timeZone);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const gridStart = new Date(first.getTime() - startOffset * 86_400_000);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(gridStart.getTime() + i * 86_400_000);
    const date = day.toISOString().slice(0, 10);
    cells.push({ date, inMonth: day.getUTCMonth() === month - 1, count: counts.get(date) ?? 0 });
  }
  return cells;
}

// --- Receipt --------------------------------------------------------------

export function receiptLines(receipt: import('../apiTypes').BookingReceiptDto, timeZone = 'UTC'): string[] {
  const when = new Intl.DateTimeFormat('en', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(receipt.startsAt));
  const lines = [`Ref ${receipt.reference}`, receipt.businessName, receipt.service, when];
  if (receipt.staff) lines.push(`With ${receipt.staff}`);
  if (receipt.price != null) lines.push(`${receipt.currency ?? ''}${receipt.price}`.trim());
  return lines;
}
