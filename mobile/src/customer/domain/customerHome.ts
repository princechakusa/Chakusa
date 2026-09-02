import type { CustomerDashboardDto } from '../../apiTypes';

// PROGRAM 2 LOOP 7: pure shaping for the Customer Home screen. The screen
// renders exactly what `/customer/dashboard` returns — this module only
// re-arranges that payload into the sections Home shows and derives a few
// display labels. No fabricated data, no network.

export interface HomeGreeting {
  title: string;
  subtitle: string;
}

export function homeGreeting(displayName: string | null | undefined, now: Date = new Date()): HomeGreeting {
  const hour = now.getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = displayName?.trim().split(/\s+/)[0];
  return {
    title: name ? `${part}, ${name}` : part,
    subtitle: 'Here’s what’s coming up',
  };
}

export interface HomeUpcoming {
  id: string;
  serviceName: string;
  businessName: string;
  startsAt: string;
  status: string;
}

export function homeUpcoming(dashboard: Pick<CustomerDashboardDto, 'upcomingAppointments'>, limit = 3): HomeUpcoming[] {
  return [...dashboard.upcomingAppointments]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit)
    .map((appointment) => ({
      id: appointment.id,
      serviceName: appointment.serviceName,
      businessName: appointment.business?.name ?? 'Your appointment',
      startsAt: appointment.startsAt,
      status: appointment.status,
    }));
}

export interface HomeBusinessLink {
  id: string;
  businessId: string;
  name: string;
  slug: string | null;
  favourite: boolean;
}

/** Saved (favourite) businesses first, then the rest of the relationships, de-duplicated. */
export function homeBusinesses(dashboard: Pick<CustomerDashboardDto, 'savedBusinesses' | 'businesses'>, limit = 6): HomeBusinessLink[] {
  const seen = new Set<string>();
  const out: HomeBusinessLink[] = [];
  for (const link of [...dashboard.savedBusinesses, ...dashboard.businesses]) {
    if (seen.has(link.businessId)) continue;
    seen.add(link.businessId);
    out.push({
      id: link.id,
      businessId: link.businessId,
      name: link.business?.name ?? 'Saved business',
      slug: link.business?.publicSlug ?? null,
      favourite: link.favourite,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

export function assistantEntryVisible(dashboard: Pick<CustomerDashboardDto, 'aiAssistant'>): boolean {
  return dashboard.aiAssistant?.entryEnabled === true;
}

export interface HomeSectionsState {
  hasUpcoming: boolean;
  hasBusinesses: boolean;
  isEmpty: boolean;
}

export function homeSectionsState(dashboard: CustomerDashboardDto): HomeSectionsState {
  const hasUpcoming = dashboard.upcomingAppointments.length > 0;
  const hasBusinesses = dashboard.savedBusinesses.length > 0 || dashboard.businesses.length > 0;
  return { hasUpcoming, hasBusinesses, isEmpty: !hasUpcoming && !hasBusinesses };
}
