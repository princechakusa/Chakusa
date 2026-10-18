import { describe, expect, it } from 'vitest';
import { mobileMonitoringConfigured, scrubDiagnosticEvent } from './mobileMonitoring';

describe('mobile monitoring privacy', () => {
  it('requires explicit enablement and a DSN outside tests', () => {
    expect(mobileMonitoringConfigured(false, 'https://dsn.example', 'production')).toBe(false);
    expect(mobileMonitoringConfigured(true, '', 'production')).toBe(false);
    expect(mobileMonitoringConfigured(true, 'https://dsn.example', 'test')).toBe(false);
    expect(mobileMonitoringConfigured(true, 'https://dsn.example', 'production')).toBe(true);
  });

  it('removes request and customer content while retaining opaque IDs', () => {
    const event = scrubDiagnosticEvent({
      request: { url: 'https://api.example/customers?token=secret', headers: { authorization: 'secret' }, data: { phone: '1' }, query_string: 'token=secret' },
      user: { id: 'user-id', email: 'private@example.com' },
      extra: { customerName: 'Private', retryCount: 2 },
      contexts: { device: { model: 'phone' }, messageBody: 'Private' },
      breadcrumbs: [{ message: 'Private customer note', data: { phone: '1', statusCode: 500 } }],
    });
    expect(event.request).toEqual({ url: 'https://api.example/customers', headers: undefined, data: undefined, query_string: undefined });
    expect(event.user).toEqual({ id: 'user-id' });
    expect(event.extra).toEqual({ retryCount: 2 });
    expect(event.contexts).toEqual({ device: { model: 'phone' } });
    expect(event.breadcrumbs).toEqual([{ message: undefined, data: { statusCode: 500 } }]);
  });

  it('scrubs nested credentials, arrays, URL credentials and bearer paths', () => {
    const event = scrubDiagnosticEvent({
      request: { url: 'https://user:private-pass@api.example/public/invoices/private-link?code=private-code#private-fragment', cookies: 'session=private-cookie' },
      extra: { operation: { apiKey: 'private-key', nested: [{ email: 'private-email', retryCount: 2 }], location: { latitude: 25, longitude: 55 } } },
      contexts: { browser: { url: 'https://api.example/public/reviews/private-review?token=private-token' } },
      breadcrumbs: [{ data: { url: '/public/quotes/private-quote?signature=private-signature', nested: { password: 'private-password', statusCode: 500 } } }],
    });
    expect(JSON.stringify(event)).not.toContain('private-');
    expect(event.request.url).toBe('https://api.example/public/invoices/[redacted]');
    expect(event.extra.operation).toEqual({ nested: [{ retryCount: 2 }] });
    expect(event.breadcrumbs[0].data.nested).toEqual({ statusCode: 500 });
  });

  it('drops free-form errors and stack locals while retaining error type and locations', () => {
    const event = scrubDiagnosticEvent({
      message: 'private-message', logentry: { message: 'private-log', params: ['private-param'] },
      exception: { values: [{ type: 'TypeError', value: 'private-error', stacktrace: { frames: [{ function: 'loadCustomer', filename: 'https://api.example/index.js?token=private-token', vars: { customer: 'private-customer' }, context_line: 'private-context' }] } }] },
      tags: { email: 'private-email', operation: 'load' },
    });
    expect(JSON.stringify(event)).not.toContain('private-');
    expect(event.exception.values[0].type).toBe('TypeError');
    expect(event.exception.values[0].stacktrace.frames[0].function).toBe('loadCustomer');
    expect(event.tags).toEqual({ operation: 'load' });
  });

  it('bounds recursive diagnostics and safely replaces cycles', () => {
    const cycle: Record<string, unknown> = { retryCount: 2 };
    cycle.loop = cycle;
    let deep: Record<string, unknown> = { value: 'private-deep' };
    for (let i = 0; i < 12; i++) deep = { next: deep };
    const serialized = JSON.stringify(scrubDiagnosticEvent({ extra: { cycle, deep } }));
    expect(serialized).toContain('[CIRCULAR]');
    expect(serialized).toContain('[MAX_DEPTH]');
    expect(serialized).not.toContain('private-deep');
  });
});
