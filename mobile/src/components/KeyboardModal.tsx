import { Modal, type ModalProps, Platform, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

// Drop-in replacement for Modal when the modal contains text fields. A bottom
// sheet in a plain Modal stays put while the keyboard opens over it, hiding
// the field being typed in. This lifts the modal's content above the keyboard
// on iOS and Android. On Android the modal must draw edge-to-edge (translucent
// bars) for keyboard-controller to track the keyboard inside the modal window.
export function KeyboardModal({ children, ...props }: ModalProps) {
  return (
    <Modal
      statusBarTranslucent={Platform.OS === 'android' ? true : props.statusBarTranslucent}
      navigationBarTranslucent={Platform.OS === 'android' ? true : props.navigationBarTranslucent}
      {...props}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        {children}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
