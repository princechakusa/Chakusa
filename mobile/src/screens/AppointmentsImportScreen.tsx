import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { parseAppointmentImportText } from '../domain/appointmentsImport';
import { ApiError } from '../services/api';
import { appointmentsApi } from '../services/endpoints';
import { RootStackParamList } from '../types';
import { Icon, M3Card, M3Header, M3Screen } from '../experience/businessKit';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';

export function AppointmentsImportScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: { id: string }[]; skipped: { reason: string }[]; failed: { reason: string }[] } | null>(null);
  const parsed = useMemo(() => parseAppointmentImportText(text), [text]);

  const chooseFile = async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/plain', 'text/tab-separated-values'], copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset) return;
      if ((asset.size ?? 0) > 1_000_000) {
        setError('Choose a CSV file smaller than 1 MB.');
        return;
      }
      setText(await new File(asset.uri).text());
      setFileName(asset.name);
    } catch {
      setError('Unable to read that appointment file.');
    }
  };
  const submit = async () => {
    if (!parsed.rows.length || importing) return;
    setImporting(true);
    setError(null);
    try {
      setResult(await appointmentsApi.bulkImport(parsed.rows));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to import appointments.');
    } finally {
      setImporting(false);
    }
  };

  const header = <M3Header businessName="Import appointments" onBack={() => navigation.goBack()} />;

  if (result) {
    return (
      <M3Screen header={header}>
        <View style={styles.titleBlock}>
          <View style={styles.doneIcon}>
            <Icon name="check_circle" size={26} color={m3.secondary} />
          </View>
          <Text style={styles.title}>Appointment import complete</Text>
          <Text style={styles.subtitle}>{result.created.length} appointments added</Text>
        </View>
        <M3Card style={styles.summaryCard}>
          <SummaryRow label="Added" count={result.created.length} tone="primary" />
          <SummaryRow label="Duplicates skipped" count={result.skipped.length} tone="neutral" />
          <SummaryRow label="Failed" count={result.failed.length} tone="error" />
        </M3Card>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </Pressable>
      </M3Screen>
    );
  }

  return (
    <M3Screen header={header} scroll={false}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <View style={styles.scrollBody}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Import appointments</Text>
            <Text style={styles.subtitle}>Preview your CSV before anything is added</Text>
          </View>

          <M3Card style={styles.dropzone}>
            <View style={styles.dropzoneIcon}>
              <Icon name="cloud_upload" size={26} color={m3.primary} />
            </View>
            <Text style={styles.dropzoneTitle}>Choose appointment CSV</Text>
            <Text style={styles.dropzoneHint}>Tap to browse local device storage</Text>
            <Pressable accessibilityRole="button" onPress={() => void chooseFile()} style={styles.chooseBtn}>
              <Text style={styles.chooseBtnText}>Choose file</Text>
            </Pressable>
            {fileName ? (
              <View style={styles.fileRow}>
                <Icon name="description" size={14} color={m3.secondary} />
                <Text style={styles.fileName}>Previewing {fileName}</Text>
              </View>
            ) : null}
          </M3Card>

          <Text style={styles.hint}>
            Columns: customer name, phone, email, service, start time, end time, price, notes. Use ISO dates such as
            2026-09-01T09:00:00+04:00.
          </Text>

          <TextInput
            accessibilityLabel="Appointment CSV"
            multiline
            value={text}
            onChangeText={setText}
            placeholder="customer name,phone,email,service,start,end,price,notes"
            placeholderTextColor={m3.onSurfaceVariant}
            style={styles.input}
            textAlignVertical="top"
          />
          <Text style={styles.hint}>
            {parsed.rows.length} ready · {parsed.skippedLines} invalid rows skipped. Imported history never sends customer
            confirmations.
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={!parsed.rows.length || importing}
            onPress={() => void submit()}
            style={[styles.primaryBtn, (!parsed.rows.length || importing) && styles.btnDisabled]}
          >
            <Text style={styles.primaryBtnText}>{importing ? 'Importing…' : `Import ${parsed.rows.length || ''} appointments`}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={importing} onPress={() => navigation.goBack()} style={[styles.secondaryBtn, importing && styles.btnDisabled]}>
            <Text style={styles.secondaryBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </M3Screen>
  );
}

function SummaryRow({ label, count, tone }: { label: string; count: number; tone: 'primary' | 'neutral' | 'error' }) {
  const color = tone === 'primary' ? m3.primary : tone === 'error' ? m3.error : m3.onSurfaceVariant;
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryCount, { color }]}>{count}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollBody: { paddingHorizontal: m3Space.md, paddingTop: m3Space.sm, paddingBottom: m3Space.xxl, gap: m3Space.md },

  titleBlock: { gap: 4, alignItems: 'flex-start' },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant },

  doneIcon: { width: 52, height: 52, borderRadius: m3Radius.full, backgroundColor: m3.secondaryContainer, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },

  dropzone: { alignItems: 'center', gap: 6, borderWidth: 1, borderColor: m3.outlineVariant, borderStyle: 'dashed' },
  dropzoneIcon: { width: 52, height: 52, borderRadius: m3Radius.full, backgroundColor: m3.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  dropzoneTitle: { ...m3Type.titleMd, color: m3.onSurface },
  dropzoneHint: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  chooseBtn: { marginTop: 6, height: 40, paddingHorizontal: 18, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  chooseBtnText: { ...m3Type.labelMd, color: m3.onSurface },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  fileName: { ...m3Type.labelSm, color: m3.secondary, letterSpacing: 0 },

  hint: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  input: {
    minHeight: 190,
    backgroundColor: m3.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: m3.outlineVariant,
    borderRadius: m3Radius.md,
    padding: m3Space.md,
    ...m3Type.bodyMd,
    color: m3.onSurface,
  },
  error: { ...m3Type.bodySm, color: m3.error },

  primaryBtn: { height: 50, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
  secondaryBtn: { height: 46, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { ...m3Type.labelLg, color: m3.onSurface },
  btnDisabled: { opacity: 0.5 },

  summaryCard: { gap: m3Space.sm },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: m3Space.sm },
  summaryCount: { ...m3Type.headlineSm, color: m3.onSurface },
  summaryLabel: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },
});
