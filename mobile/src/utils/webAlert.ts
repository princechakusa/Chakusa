import { Alert, Platform, type AlertButton } from 'react-native';

// react-native-web ships Alert.alert as a no-op, so on web every
// confirmation in the app (sign out, archive, delete, cancel booking…)
// silently did nothing. This maps Alert.alert onto the browser's own
// dialogs. iOS and Android keep their native alerts untouched.

type ConfirmFn = (message: string) => boolean;
type NotifyFn = (message: string) => void;

/**
 * Pure decision logic, exported for tests: shows the alert with the given
 * browser dialogs and runs the button a native alert would have run.
 * - No buttons / one button: an informational alert, then that button.
 * - Otherwise: one confirm per non-cancel action, in order; the first
 *   accepted action runs. Declining all of them runs the cancel button.
 */
export function runWebAlert(title: string, message: string | undefined, buttons: AlertButton[] | undefined, confirm: ConfirmFn, notify: NotifyFn) {
  const text = message ? `${title}\n\n${message}` : title;
  const list = buttons ?? [];
  if (list.length <= 1) {
    notify(text);
    list[0]?.onPress?.();
    return;
  }
  const cancel = list.find((button) => button.style === 'cancel');
  const actions = list.filter((button) => button !== cancel);
  for (const action of actions) {
    const prompt = actions.length === 1 ? text : `${text}\n\n${action.text ?? 'OK'}?`;
    if (confirm(prompt)) { action.onPress?.(); return; }
  }
  cancel?.onPress?.();
}

export function installWebAlert() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  Alert.alert = (title, message, buttons) => runWebAlert(title, message, buttons, (m) => window.confirm(m), (m) => window.alert(m));
}
