import { useEffect, useState } from 'react';
import { Keyboard, KeyboardEvent, LayoutAnimation, Platform } from 'react-native';

/**
 * Height of the on-screen keyboard, 0 when hidden.
 *
 * The app draws edge-to-edge (Android 15+ enforces it), so Android no longer
 * shrinks the window for the keyboard and `adjustResize` does nothing; iOS
 * never did. Chat screens pad their bottom by this height so the composer
 * rides exactly on top of the keyboard, like WhatsApp. iOS animates in step
 * with the keyboard (will* events); Android reports after it settles.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const animate = (event?: KeyboardEvent) => {
      if (!ios || !event?.duration) return;
      LayoutAnimation.configureNext({ duration: event.duration, update: { type: LayoutAnimation.Types.keyboard } });
    };
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) => { animate(event); setHeight(event.endCoordinates.height); });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (event) => { animate(event); setHeight(0); });
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}
