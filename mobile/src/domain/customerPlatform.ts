import type {
  CustomerDashboardDto,
  CustomerNotificationCategory,
  CustomerNotificationDto,
  CustomerSelfProfileDto,
  CustomerSessionResponse,
} from '../apiTypes';

// PROGRAM 2 LOOP 1: pure product rules for the customer-side mobile
// foundation — authentication flow, dashboard, profile/settings and
// notifications. No Marketplace / Booking logic (later loops).

// --- Authentication flow -------------------------------------------------

export type CustomerAuthState = 'unauthenticated' | 'verify-email' | 'ready' | 'suspended' | 'closed';

export function customerAuthState(session: {
  hasToken: boolean;
  profile?: Pick<CustomerSelfProfileDto, 'status' | 'verified'> | null;
  verificationRequired?: boolean;
} | null): CustomerAuthState {
  if (!session || !session.hasToken || !session.profile) return 'unauthenticated';
  if (session.profile.status === 'DELETED') return 'closed';
  if (session.profile.status === 'SUSPENDED') return 'suspended';
  if (!session.profile.verified && session.verificationRequired) return 'verify-email';
  return 'ready';
}

export type CustomerRoute = 'Login' | 'VerifyEmail' | 'CustomerHome' | 'AccountSuspended' | 'AccountClosed';

export function initialCustomerRoute(state: CustomerAuthState): CustomerRoute {
  switch (state) {
    case 'ready':
      return 'CustomerHome';
    case 'verify-email':
      return 'VerifyEmail';
    case 'suspended':
      return 'AccountSuspended';
    case 'closed':
      return 'AccountClosed';
    default:
      return 'Login';
  }
}

/** Whether a customer nav action is currently permitted. */
export function canNavigateCustomer(state: CustomerAuthState, target: 'dashboard' | 'profile' | 'settings' | 'notifications'): boolean {
  return state === 'ready' && ['dashboard', 'profile', 'settings', 'notifications'].includes(target);
}

export function sessionFromResponse(response: CustomerSessionResponse) {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    user: response.user,
    profile: response.profile,
    verificationRequired: response.verificationRequired ?? !response.profile.verified,
  };
}

// --- Validation --------------------------------------------------------

export function validateRegistration(input: { email: string; password: string; fullName: string }): string[] {
  const errors: string[] = [];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) errors.push('Enter a valid email address.');
  if (input.password.length < 8) errors.push('Password must be at least 8 characters.');
  if (!input.fullName.trim()) errors.push('Enter your name.');
  return errors;
}

export const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'pt', 'sw', 'ar'] as const;
export function isSupportedLanguage(code: string): boolean {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

// --- Dashboard -------------------------------------------------------

export interface DashboardSummary {
  nextAppointment: CustomerDashboardDto['upcomingAppointments'][number] | null;
  upcomingCount: number;
  unreadNotifications: number;
  savedBusinessCount: number;
  hasActivity: boolean;
  aiAssistantEnabled: boolean;
}

export function summarizeDashboard(dashboard: CustomerDashboardDto): DashboardSummary {
  return {
    nextAppointment: dashboard.upcomingAppointments[0] ?? null,
    upcomingCount: dashboard.upcomingAppointments.length,
    unreadNotifications: dashboard.unreadNotifications,
    savedBusinessCount: dashboard.savedBusinesses.length,
    hasActivity: dashboard.activityHistory.length > 0,
    aiAssistantEnabled: dashboard.aiAssistant.entryEnabled,
  };
}

export function dashboardIsEmpty(dashboard: CustomerDashboardDto): boolean {
  return (
    dashboard.upcomingAppointments.length === 0 &&
    dashboard.recentConversations.length === 0 &&
    dashboard.businesses.length === 0 &&
    dashboard.activityHistory.length === 0
  );
}

// --- Notifications ------------------------------------------------

const CATEGORY_LABEL: Record<CustomerNotificationCategory, string> = {
  booking_update: 'Bookings',
  message: 'Messages',
  ai_reply: 'AI assistant',
  promotion: 'Offers',
  review_reminder: 'Reviews',
  appointment_reminder: 'Reminders',
};

export function notificationCategoryLabel(category: CustomerNotificationCategory | string): string {
  return CATEGORY_LABEL[category as CustomerNotificationCategory] ?? 'Updates';
}

export function unreadCount(notifications: CustomerNotificationDto[]): number {
  return notifications.filter((notification) => notification.readAt === null).length;
}

export function notificationBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

export function groupNotificationsByCategory(notifications: CustomerNotificationDto[]): Array<{ category: string; label: string; items: CustomerNotificationDto[] }> {
  const groups = new Map<string, CustomerNotificationDto[]>();
  for (const notification of notifications) {
    const list = groups.get(notification.category) ?? [];
    list.push(notification);
    groups.set(notification.category, list);
  }
  return [...groups.entries()].map(([category, items]) => ({ category, label: notificationCategoryLabel(category), items }));
}

/** Merge a preference patch, keeping unspecified categories/channels intact. */
export function mergeNotificationPreferences(
  current: Record<string, Record<string, boolean>>,
  patch: Record<string, Partial<Record<string, boolean>>>,
): Record<string, Record<string, boolean>> {
  const next: Record<string, Record<string, boolean>> = { ...current };
  for (const [category, channels] of Object.entries(patch)) {
    next[category] = { ...(current[category] ?? {}), ...channels } as Record<string, boolean>;
  }
  return next;
}
