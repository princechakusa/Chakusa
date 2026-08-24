import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN, SENTRY_ENABLED } from '../config';
import { mobileMonitoringConfigured, scrubDiagnosticEvent } from '../domain/mobileMonitoring';

export function initMobileMonitoring() {
  if (!mobileMonitoringConfigured(SENTRY_ENABLED, SENTRY_DSN, process.env.NODE_ENV)) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    enableAutoSessionTracking: false,
    enableAutoPerformanceTracing: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    beforeSend: event => scrubDiagnosticEvent(event),
  });
}

export function setMobileMonitoringIdentity(userId: string, businessId: string | null, role: string | null) {
  if (!mobileMonitoringConfigured(SENTRY_ENABLED, SENTRY_DSN, process.env.NODE_ENV)) return;
  Sentry.setUser({ id: userId });
  Sentry.setTag('business_id', businessId ?? 'none');
  Sentry.setTag('business_role', role ?? 'none');
}

export function clearMobileMonitoringIdentity() {
  if (!mobileMonitoringConfigured(SENTRY_ENABLED, SENTRY_DSN, process.env.NODE_ENV)) return;
  Sentry.setUser(null);
  Sentry.setTag('business_id', 'none');
  Sentry.setTag('business_role', 'none');
}
