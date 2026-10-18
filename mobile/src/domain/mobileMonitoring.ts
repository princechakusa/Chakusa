const SENSITIVE_KEY = /authorization|cookie|password|token|secret|credential|email|phone|name|address|message|body|notes|payload|content|contact|latitude|longitude|location|api[-_]?key/i;
const BEARER_PATH = /(\/public\/(?:reviews|quotes|invoices|team-invites|calendar))\/[^/]+/gi;

export interface DiagnosticEvent {
  request?: { url?: string; headers?: Record<string, unknown>; data?: unknown; query_string?: unknown; cookies?: unknown; env?: unknown };
  user?: Record<string, unknown>;
  breadcrumbs?: { data?: Record<string, unknown>; message?: string }[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  message?: unknown;
  logentry?: unknown;
  exception?: { values?: { value?: unknown; stacktrace?: { frames?: Record<string, unknown>[] } }[] };
}

export function mobileMonitoringConfigured(enabled: boolean, dsn: string, nodeEnvironment?: string) {
  return enabled && dsn.trim().length > 0 && nodeEnvironment !== 'test';
}

function scrubUrl(value: string): string {
  try {
    if (!/^(https?:\/\/|\/)/i.test(value)) return '[redacted-url]';
    const url = new URL(value, 'https://diagnostic.invalid');
    if (!['http:', 'https:'].includes(url.protocol)) return '[redacted-url]';
    const path = url.pathname.replace(BEARER_PATH, '$1/[redacted]');
    return value.startsWith('/') ? path : `${url.origin}${path}`;
  } catch { return '[redacted-url]'; }
}

function scrubValue(value: unknown, seen: WeakSet<object>, depth: number, key: string): unknown {
  if (depth >= 8) return '[MAX_DEPTH]';
  if (typeof value === 'string') return /url|uri/i.test(key) ? scrubUrl(value) : value.slice(0, 4_000);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  const cleaned = Array.isArray(value)
    ? value.slice(0, 50).map(item => scrubValue(item, seen, depth + 1, key))
    : Object.fromEntries(Object.entries(value).slice(0, 100)
      .filter(([childKey]) => !SENSITIVE_KEY.test(childKey))
      .map(([childKey, item]) => [childKey, scrubValue(item, seen, depth + 1, childKey)]));
  seen.delete(value);
  return cleaned;
}

function scrubRecord(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) return undefined;
  return scrubValue(record, new WeakSet(), 0, '') as Record<string, unknown>;
}

export function scrubDiagnosticEvent<T extends object>(event: T): T {
  const diagnostic = event as T & DiagnosticEvent;
  if (diagnostic.request) {
    diagnostic.request.headers = undefined;
    diagnostic.request.data = undefined;
    diagnostic.request.query_string = undefined;
    if ('cookies' in diagnostic.request) diagnostic.request.cookies = undefined;
    if ('env' in diagnostic.request) diagnostic.request.env = undefined;
    if (diagnostic.request.url) diagnostic.request.url = scrubUrl(diagnostic.request.url);
  }
  if (diagnostic.user) diagnostic.user = diagnostic.user.id ? { id: diagnostic.user.id } : undefined;
  diagnostic.extra = scrubRecord(diagnostic.extra);
  diagnostic.contexts = scrubRecord(diagnostic.contexts);
  diagnostic.tags = scrubRecord(diagnostic.tags);
  // Unstructured error text and stack locals can contain arbitrary customer data.
  // Preserve exception types and stack positions for grouping and diagnosis.
  if ('message' in diagnostic) diagnostic.message = undefined;
  if ('logentry' in diagnostic) diagnostic.logentry = undefined;
  for (const exception of diagnostic.exception?.values ?? []) {
    exception.value = undefined;
    if (exception.stacktrace?.frames) exception.stacktrace.frames = exception.stacktrace.frames.map(frame => ({
      ...frame, vars: undefined, pre_context: undefined, context_line: undefined, post_context: undefined, abs_path: undefined,
      filename: typeof frame.filename === 'string'
        ? (frame.filename.includes('://') ? scrubUrl(frame.filename) : frame.filename.split(/[?#]/)[0])
        : frame.filename,
    }));
  }
  diagnostic.breadcrumbs = diagnostic.breadcrumbs?.map(breadcrumb => ({
    ...breadcrumb,
    message: undefined,
    data: scrubRecord(breadcrumb.data),
  }));
  return event;
}
