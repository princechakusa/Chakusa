import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { AppHeader, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { BulkImportCustomersResultDto } from '../apiTypes';
import { parseCustomerImportText } from '../domain/customersImport';
import { ApiError } from '../services/api';
import { customersApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

export function CustomersImportScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportCustomersResultDto | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const parsed = useMemo(() => parseCustomerImportText(text), [text]);

  const submit = async () => {
    if (importing || parsed.rows.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      setResult(await customersApi.bulkImport(parsed.rows));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to import customers.');
    } finally {
      setImporting(false);
    }
  };
  const chooseFile = async () => { setError(null); try { const picked = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/plain', 'text/tab-separated-values'], copyToCacheDirectory: true }); if (picked.canceled) return; const asset = picked.assets[0]; if (!asset) return; if ((asset.size ?? 0) > 1_000_000) { setError('Choose a CSV file smaller than 1 MB.'); return; } const contents = await new File(asset.uri).text(); setText(contents); setFileName(asset.name); } catch { setError('Unable to read that file. Choose a CSV or text file and try again.'); } };

  if (result) {
    return <Screen>
      <AppHeader eyebrow="CUSTOMERS" title="Import complete" subtitle={`${result.created.length} added`} />
      <View style={styles.summary}>
        <SummaryRow label="Added" count={result.created.length} />
        {result.skipped.length > 0 ? <SummaryRow label="Skipped (already exists or plan limit reached)" count={result.skipped.length} /> : null}
        {result.failed.length > 0 ? <SummaryRow label="Failed" count={result.failed.length} /> : null}
      </View>
      <PrimaryButton fullWidth label="Done" onPress={() => navigation.goBack()} />
    </Screen>;
  }

  return <Screen>
    <AppHeader eyebrow="CUSTOMERS" title="Import your customer list" subtitle="Paste names and phone numbers, one per line" />
    <SecondaryButton fullWidth label="Choose CSV file" onPress={() => void chooseFile()} />{fileName ? <Text style={styles.fileName}>Previewing {fileName}</Text> : null}
    <Text style={styles.hint}>One customer per line: name, then phone and/or email, separated by a comma or tab. For example:{'\n'}Jane Doe, +263771234567{'\n'}John Smith, john@example.com</Text>
    <TextInput
      accessibilityLabel="Pasted customer list"
      multiline
      onChangeText={setText}
      placeholder={'Jane Doe, +263771234567\nJohn Smith, john@example.com'}
      placeholderTextColor={colors.tabInactive}
      style={styles.input}
      value={text}
    />
    <Text style={styles.count}>{parsed.rows.length} customer{parsed.rows.length === 1 ? '' : 's'} ready to import{parsed.skippedLines > 0 ? ` · ${parsed.skippedLines} line${parsed.skippedLines === 1 ? '' : 's'} skipped (no name)` : ''}</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <PrimaryButton disabled={importing || parsed.rows.length === 0} fullWidth label={importing ? 'Importing…' : `Import ${parsed.rows.length || ''} customer${parsed.rows.length === 1 ? '' : 's'}`} onPress={() => void submit()} />
    <SecondaryButton disabled={importing} fullWidth label="Cancel" onPress={() => navigation.goBack()} />
  </Screen>;
}

function SummaryRow({ label, count }: { label: string; count: number }) {
  return <View style={styles.summaryRow}><Text style={styles.summaryCount}>{count}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
  input: { minHeight: 180, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, ...typography.body, color: colors.text, textAlignVertical: 'top', marginBottom: spacing.xs },
  count: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
  fileName: { ...typography.caption, color: colors.primary, marginBottom: spacing.sm },
  error: { ...typography.caption, color: colors.negative, marginBottom: spacing.sm },
  summary: { gap: spacing.sm, marginBottom: spacing.xl },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  summaryCount: { ...typography.heading, color: colors.primary },
  summaryLabel: { ...typography.body, color: colors.textSecondary },
});
