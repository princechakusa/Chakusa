const SENSITIVE_KEY = /authorization|cookie|password|token|secret|email|phone|name|address|message|body|notes/i;

export interface DiagnosticEvent {
  request?: { url?: string; headers?: Record<string, unknown>; data?: unknown; query_string?: unknown };
  user?: Record<string, unknown>;
  breadcrumbs?: { data?: Record<string, unknown>; message?: string }[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
}

export function mobileMonitoringConfigured(enabled: boolean, dsn: string, nodeEnvironment?: string) {
  return enabled && dsn.trim().length > 0 && nodeEnvironment !== 'test';
}

function scrubRecord(record: Record<string, unknown> | undefined) {
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).filter(([key]) => !SENSITIVE_KEY.test(key)));
}

export function scrubDiagnosticEvent<T extends object>(event: T): T {
  const diagnostic = event as T & DiagnosticEvent;
  if (diagnostic.request) {
    diagnostic.request.headers = undefined;
    diagnostic.request.data = undefined;
    diagnostic.request.query_string = undefined;
    if (diagnostic.request.url) diagnostic.request.url = diagnostic.request.url.split('?')[0];
  }
  if (diagnostic.user) diagnostic.user = diagnostic.user.id ? { id: diagnostic.user.id } : undefined;
  diagnostic.extra = scrubRecord(diagnostic.extra);
  diagnostic.contexts = scrubRecord(diagnostic.contexts);
  diagnostic.breadcrumbs = diagnostic.breadcrumbs?.map(breadcrumb => ({
    ...breadcrumb,
    message: undefined,
    data: scrubRecord(breadcrumb.data),
  }));
  return event;
}
