import { useEffect } from 'react';
import { clearMobileMonitoringIdentity, setMobileMonitoringIdentity } from '../services/mobileMonitoring';
import { useAuth } from '../state/AuthContext';

export function MobileMonitoringIdentity() {
  const { user, business, role } = useAuth();
  useEffect(() => {
    if (user) setMobileMonitoringIdentity(user.id, business?.id ?? null, role);
    else clearMobileMonitoringIdentity();
  }, [business?.id, role, user]);
  return null;
}
