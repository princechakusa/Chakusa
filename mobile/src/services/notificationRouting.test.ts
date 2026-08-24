import { describe, expect, it } from 'vitest';
import { directNotificationTarget } from '../domain/notificationTarget';

describe('appointment notification routing', () => {
  it('opens the appointment identified by a reminder push', async () => {
    expect(directNotificationTarget({ type: 'appointment', appointmentId: 'appointment-1' })).toEqual({
      screen: 'AppointmentEditor',
      params: { appointmentId: 'appointment-1' },
    });
  });

  it('ignores malformed appointment payloads', async () => {
    expect(directNotificationTarget({ type: 'appointment', appointmentId: '  ' })).toBeNull();
  });
});
