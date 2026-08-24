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
});
