import { useEffect, useState } from 'react';
import { Keyboard, KeyboardEvent, LayoutAnimation, Platform } from 'react-native';

export interface KeyboardFrame {
  /** Keyboard height, 0 when hidden. */
  height: number;
  /** Window y where the keyboard begins (Infinity when hidden). */
  top: number;
}

/**
 * The on-screen keyboard's frame.
 *
 * The app draws edge-to-edge (Android 15+ enforces it), so Android no longer
 * shrinks the window for the keyboard and `adjustResize` does nothing; iOS
 * never did. Screens pad by this height (and scroll the focused field above
 * `top`) so nothing the person is typing into is hidden. iOS animates in step
 * with the keyboard (will* events); Android reports after it settles.
 */
export function useKeyboardFrame(): KeyboardFrame {
  const [frame, setFrame] = useState<KeyboardFrame>({ height: 0, top: Number.POSITIVE_INFINITY });
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const animate = (event?: KeyboardEvent) => {
      if (!ios || !event?.duration) return;
      LayoutAnimation.configureNext({ duration: event.duration, update: { type: LayoutAnimation.Types.keyboard } });
    };
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      animate(event);
      setFrame({ height: event.endCoordinates.height, top: event.endCoordinates.screenY });
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (event) => {
      animate(event);
      setFrame({ height: 0, top: Number.POSITIVE_INFINITY });
    });
    return () => { show.remove(); hide.remove(); };
  }, []);
  return frame;
}

export function useKeyboardHeight(): number {
  return useKeyboardFrame().height;
}
