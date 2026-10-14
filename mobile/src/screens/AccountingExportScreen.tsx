import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { m3, m3Space, m3Type } from '../experience/businessTheme';
import { M3Card, M3Header, M3Screen } from '../experience/businessKit';
import { SecondaryButton } from '../components/ui';
import { API_URL } from '../config';
import { accountingApi } from '../services/endpoints';
import { ApiError } from '../services/api';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Calendar periods in the device's time zone, as [start, end) ISO strings. */
export function exportPeriods(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const at = (year: number, month: number) => new Date(year, month, 1).toISOString();
  return [
    { key: 'this-month', label: 'This month', from: at(y, m), to: at(y, m + 1) },
    { key: 'last-month', label: 'Last month', from: at(y, m - 1), to: at(y, m) },
    { key: 'this-year', label: `${y} so far`, from: at(y, 0), to: at(y, m + 1) },
    { key: 'last-year', label: `${y - 1}`, from: at(y - 1, 0), to: at(y, 0) },
  ];
}

// Accounting export: invoices and payments as a CSV that QuickBooks, Xero or
// an accountant can import. The server mints a 10-minute signed link and the
// file downloads in the browser, so nothing native is needed.
export function AccountingExportScreen() {
  const navigation = useNavigation<Nav>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (period: ReturnType<typeof exportPeriods>[number]) => {
    if (busy) return;
    setBusy(period.key);
    setError(null);
    try {
      const { path } = await accountingApi.exportLink(period.from, period.to);
      if (!API_URL) throw new Error('The app has no API address configured.');
      await Linking.openURL(`${API_URL.replace(/\/$/, '')}${path}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not prepare the export. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <M3Screen header={<M3Header businessName="Accounting export" onBack={() => navigation.goBack()} />}>
      <M3Card>
        <Text style={styles.title}>Invoices and payments for your books</Text>
        <Text style={styles.body}>Download a CSV file with every sent invoice and card payment for a period. QuickBooks, Xero and most accounting tools can import it, or send it to your accountant.</Text>
      </M3Card>
      <View style={styles.list}>
        {exportPeriods().map((period) => (
          <SecondaryButton key={period.key} fullWidth disabled={busy !== null} label={busy === period.key ? 'Preparing…' : `Download ${period.label}`} onPress={() => void download(period)} />
        ))}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Text style={styles.note}>The download link works once your browser opens it and expires after 10 minutes. Direct QuickBooks and Xero sync is coming later.</Text>
    </M3Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...m3Type.titleMd, color: m3.onSurface },
  body: { ...m3Type.bodyMd, color: m3.onSurfaceVariant, marginTop: m3Space.xs },
  list: { gap: m3Space.sm },
  error: { ...m3Type.bodyMd, color: m3.error },
  note: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
});
