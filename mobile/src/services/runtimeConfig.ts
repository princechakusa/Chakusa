import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { API_URL, BUILD_DEFAULTS, applyRuntimeConfig } from '../config';
import { mergeConfig, parseRemoteConfig, type EffectiveConfig, type RemoteAppConfig } from '../domain/runtimeConfig';

// Loads the admin-controlled runtime config (GET /app-config) and applies it
// to config.ts's live exports. Order at launch:
//   1. apply the last cached copy (fast, works offline),
//   2. fetch a fresh copy in the background, apply and cache it,
//   3. re-fetch when the app returns to the foreground (throttled).
// Any failure leaves the previous values in place; build defaults are the
// floor. The cache holds only public, non-personal configuration.

const CACHE_KEY = 'chakusa.appConfig.v1';
const FETCH_TIMEOUT_MS = 4000;
const REFRESH_EVERY_MS = 5 * 60 * 1000;

let current: EffectiveConfig = mergeConfig(BUILD_DEFAULTS, null);
let lastFetch = 0;
const listeners = new Set<() => void>();

function publish(remote: RemoteAppConfig | null) {
  current = mergeConfig(BUILD_DEFAULTS, remote);
  applyRuntimeConfig(current);
  listeners.forEach((l) => l());
}

async function readCache(): Promise<unknown> {
  try {
    const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(CACHE_KEY) ?? null : await SecureStore.getItemAsync(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function writeCache(payload: unknown) {
  try {
    const raw = JSON.stringify(payload);
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(CACHE_KEY, raw);
    else await SecureStore.setItemAsync(CACHE_KEY, raw);
  } catch { /* best effort */ }
}

export async function refreshRuntimeConfig(): Promise<void> {
  if (!API_URL) return;
  lastFetch = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/app-config`, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const payload: unknown = await res.json();
    const remote = parseRemoteConfig(payload);
    if (!remote) return;
    publish(remote);
    await writeCache(payload);
  } catch { /* offline or slow: keep what we have */ } finally { clearTimeout(timer); }
}

let started = false;
/** Call once at launch. Resolves after the cached copy is applied (never waits on the network). */
export async function startRuntimeConfig(): Promise<void> {
  if (started) return;
  started = true;
  const cached = parseRemoteConfig(await readCache());
  if (cached) publish(cached);
  void refreshRuntimeConfig();
  AppState.addEventListener('change', (state) => {
    if (state === 'active' && Date.now() - lastFetch > REFRESH_EVERY_MS) void refreshRuntimeConfig();
  });
}

export function getRuntimeConfig(): EffectiveConfig { return current; }

/** Re-renders when the runtime config changes. */
export function useRuntimeConfig(): EffectiveConfig {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, getRuntimeConfig, getRuntimeConfig);
}
