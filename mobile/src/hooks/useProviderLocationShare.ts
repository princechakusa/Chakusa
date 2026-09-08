import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { appointmentsApi } from '../services/endpoints';
import { ApiError } from '../services/api';

// Live Location #14 (provider side). FOREGROUND ONLY: positions are read on a
// timer while this hook is mounted and the app is in the foreground. There is
// no background task and no persistent location permission. Sharing stops on
// unmount, on error, or when the provider taps stop; the server also expires
// it independently.
const PUSH_INTERVAL_MS = 15_000;

type State = {
  sharing: boolean;
  busy: boolean;
  error: string | null;
  permissionDenied: boolean;
};

export function useProviderLocationShare(appointmentId: string | undefined) {
  const [state, setState] = useState<State>({ sharing: false, busy: false, error: null, permissionDenied: false });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const clearTimer = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  };

  const pushOnce = useCallback(async () => {
    if (!appointmentId || stoppedRef.current) return;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await appointmentsApi.updateLocationShare(appointmentId, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy == null ? undefined : Math.round(pos.coords.accuracy),
      });
    } catch (caught) {
      // 429 (rate limited) is benign — skip this tick. 409 means the server
      // ended the share (arrived / completed / expired): stop cleanly.
      if (caught instanceof ApiError && caught.message.toLowerCase().includes('rate')) return;
      clearTimer();
      stoppedRef.current = true;
      setState(s => ({ ...s, sharing: false, error: caught instanceof ApiError ? caught.message : 'Location sharing stopped.' }));
    }
  }, [appointmentId]);

  const start = useCallback(async () => {
    if (!appointmentId || state.busy || state.sharing) return;
    setState(s => ({ ...s, busy: true, error: null, permissionDenied: false }));
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setState(s => ({ ...s, busy: false, permissionDenied: true }));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await appointmentsApi.startLocationShare(appointmentId, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy == null ? undefined : Math.round(pos.coords.accuracy),
      });
      stoppedRef.current = false;
      setState(s => ({ ...s, busy: false, sharing: true }));
      clearTimer();
      timer.current = setInterval(() => { void pushOnce(); }, PUSH_INTERVAL_MS);
    } catch (caught) {
      setState(s => ({ ...s, busy: false, error: caught instanceof ApiError ? caught.message : 'Could not start location sharing.' }));
    }
  }, [appointmentId, state.busy, state.sharing, pushOnce]);

  const stop = useCallback(async () => {
    clearTimer();
    stoppedRef.current = true;
    setState(s => ({ ...s, sharing: false }));
    if (appointmentId) await appointmentsApi.stopLocationShare(appointmentId).catch(() => undefined);
  }, [appointmentId]);

  // Never let sharing outlive the screen.
  useEffect(() => () => {
    clearTimer();
    if (!stoppedRef.current && appointmentId) {
      stoppedRef.current = true;
      void appointmentsApi.stopLocationShare(appointmentId).catch(() => undefined);
    }
  }, [appointmentId]);

  return { ...state, start, stop };
}
