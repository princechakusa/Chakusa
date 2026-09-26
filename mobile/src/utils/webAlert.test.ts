import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Alert: {}, Platform: { OS: 'web' } }));
const { runWebAlert } = await import('./webAlert');

describe('runWebAlert', () => {
  it('confirms a destructive action and runs it when accepted', () => {
    const cancel = vi.fn(); const logout = vi.fn(); const confirm = vi.fn(() => true);
    runWebAlert('Sign out?', 'Other devices stay signed in.', [{ text: 'No', style: 'cancel', onPress: cancel }, { text: 'Yes, sign out', style: 'destructive', onPress: logout }], confirm, vi.fn());
    expect(confirm).toHaveBeenCalledWith('Sign out?\n\nOther devices stay signed in.');
    expect(logout).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('runs the cancel button when the person declines', () => {
    const cancel = vi.fn(); const del = vi.fn();
    runWebAlert('Delete?', undefined, [{ text: 'Cancel', style: 'cancel', onPress: cancel }, { text: 'Delete', style: 'destructive', onPress: del }], () => false, vi.fn());
    expect(del).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('asks about each action in turn when there are several', () => {
    const a = vi.fn(); const b = vi.fn();
    const answers = [false, true];
    const confirm = vi.fn(() => answers.shift()!);
    runWebAlert('Choose', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Email it', onPress: a }, { text: 'Text it', onPress: b }], confirm, vi.fn());
    expect(confirm).toHaveBeenNthCalledWith(1, 'Choose\n\nEmail it?');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('shows a plain alert for information and runs its only button', () => {
    const ok = vi.fn(); const notify = vi.fn();
    runWebAlert('Copied', 'Link copied.', [{ text: 'OK', onPress: ok }], vi.fn(), notify);
    expect(notify).toHaveBeenCalledWith('Copied\n\nLink copied.');
    expect(ok).toHaveBeenCalledOnce();
    runWebAlert('Saved', undefined, undefined, vi.fn(), notify);
    expect(notify).toHaveBeenLastCalledWith('Saved');
  });
});
