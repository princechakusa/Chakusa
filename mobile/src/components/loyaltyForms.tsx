import { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { PrimaryButton, SecondaryButton } from './ui';
import { colors, radius, spacing, typography } from '../theme';

// PROGRAM 2 LOOP 6: shared form primitives for the business loyalty screens,
// built on the existing ui.tsx components + theme tokens. No new design
// system — this is the same bottom-sheet form pattern ServiceCatalogScreen
// already uses, factored out so the loyalty screens stay small.

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function TextField({ label, value, onChangeText, placeholder, multiline, accessibilityLabel }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; multiline?: boolean; accessibilityLabel?: string;
}) {
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        multiline={multiline}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

export function NumberField({ label, value, onChangeText, placeholder, hint }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; hint?: string;
}) {
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        accessibilityLabel={label}
        keyboardType="number-pad"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function SwitchRow({ label, detail, value, onValueChange }: { label: string; detail?: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchCopy}>
        <Text style={styles.switchLabel}>{label}</Text>
        {detail ? <Text style={styles.hint}>{detail}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} trackColor={{ false: colors.border, true: colors.success }} thumbColor={colors.surface} />
    </View>
  );
}

export function Segmented<T extends string>({ label, options, value, onChange, renderLabel }: {
  label: string; options: readonly T[]; value: T; onChange: (v: T) => void; renderLabel: (v: T) => string;
}) {
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.segment} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={renderLabel(option)}
              onPress={() => onChange(option)}
              style={[styles.segmentItem, selected && styles.segmentItemActive]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{renderLabel(option)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text accessibilityRole="alert" style={styles.error}>{message}</Text>;
}

export function FormModal({ visible, title, busy, onClose, onSubmit, submitLabel, children }: {
  visible: boolean; title: string; busy: boolean; onClose: () => void; onSubmit: () => void; submitLabel: string; children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>{title}</Text>
            {children}
            <PrimaryButton fullWidth disabled={busy} label={busy ? 'Saving…' : submitLabel} onPress={onSubmit} />
            <SecondaryButton fullWidth disabled={busy} label="Cancel" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { ...typography.caption, color: colors.text },
  hint: { ...typography.caption, color: colors.textSecondary },
  input: { minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...typography.body, color: colors.text },
  multiline: { minHeight: 76, paddingTop: spacing.sm, textAlignVertical: 'top' },
  switchRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  switchCopy: { flex: 1, minWidth: 0, gap: 2 },
  switchLabel: { ...typography.bodyStrong, color: colors.text },
  segment: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, backgroundColor: colors.surface },
  segmentItemActive: { backgroundColor: colors.primarySoft },
  segmentText: { ...typography.caption, color: colors.textSecondary },
  segmentTextActive: { color: colors.primary, fontWeight: '700' },
  error: { ...typography.caption, color: colors.negative },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: { maxHeight: '94%', backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  sheetTitle: { ...typography.heading, color: colors.text },
});
