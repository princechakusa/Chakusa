import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { businessApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Icon, M3Card, M3Header, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const OWNED = [
  'Client records, contact details and notes',
  'Appointments, quotes, invoices and payments',
  'Reviews, feedback and message history',
  'Team, services and business settings',
];

export function DataGovernanceScreen() {
  const navigation = useNavigation<Nav>();
  const { business, role } = useAuth();
  const [exporting, setExporting] = useState(false);
  const owner = role === 'OWNER';
  const businessName = business?.name ?? 'your business';

  const exportAll = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const data = await businessApi.exportData();
      await Share.share({
        title: `${businessName} data export`,
        message: JSON.stringify(data, null, 2),
      });
    } catch (error) {
      Alert.alert('Could not export data', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <M3Screen
      header={
        <M3Header
          businessName="More"
          onBack={() => navigation.goBack()}
          onNotificationsPress={() => navigation.navigate('AttentionCenter')}
          hasNotifications={false}
        />
      }
    >
      <View style={styles.titleBlock}>
        <Text style={styles.eyebrow}>SYSTEM &amp; DATA GOVERNANCE</Text>
        <Text style={styles.title}>Data &amp; Legal</Text>
        <Text style={styles.subtitle}>Your ownership of {businessName}'s records, and the documents that govern this account.</Text>
      </View>

      <M3Card style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.cardIcon}>
            <Icon name="shield" size={20} color={m3.primary} />
          </View>
          <Text style={styles.cardTitle}>You own your data</Text>
        </View>
        <Text style={styles.body}>
          {businessName} keeps sole ownership of every record below. There is no lock-in — an export is a plain JSON
          file you can take anywhere, any time.
        </Text>
        <View style={styles.ownedList}>
          {OWNED.map((line) => (
            <View key={line} style={styles.ownedRow}>
              <Icon name="check_circle" size={15} color={m3.secondary} />
              <Text style={styles.ownedText}>{line}</Text>
            </View>
          ))}
        </View>
      </M3Card>

      {owner ? (
        <M3Card style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.cardIcon, { backgroundColor: 'rgba(0,106,97,0.12)' }]}>
              <Icon name="download" size={20} color={m3.secondary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Export business data</Text>
              <Text style={styles.body}>A full copy of the records above, as JSON.</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={exporting}
            onPress={() => void exportAll()}
            style={[styles.primaryBtn, exporting && styles.disabled]}
          >
            <Icon name="download_for_offline" size={18} color={m3.onPrimary} />
            <Text style={styles.primaryBtnText}>{exporting ? 'Preparing export…' : 'Export everything'}</Text>
          </Pressable>
        </M3Card>
      ) : null}

      <Text style={styles.sectionTitle}>LEGAL DOCUMENTS</Text>
      <M3Card padded={false} style={styles.menuCard}>
        <LegalRow
          icon="gavel"
          title="Terms of use"
          detail="How Chakusa and your business work together"
          onPress={() => navigation.navigate('LegalDocument', { page: 'terms' })}
        />
        <LegalRow
          icon="lock"
          title="Privacy policy"
          detail="How personal data is handled and protected"
          onPress={() => navigation.navigate('LegalDocument', { page: 'privacy' })}
        />
        <LegalRow
          icon="tune"
          title="Cookie preferences"
          detail="Analytics and diagnostic choices on this device"
          onPress={() => navigation.navigate('CookiePreferences')}
          last
        />
      </M3Card>
    </M3Screen>
  );
}

function LegalRow({
  icon,
  title,
  detail,
  onPress,
  last,
}: {
  icon: string;
  title: string;
  detail: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [styles.legalRow, !last && styles.legalBorder, pressed && styles.rowPressed]}
    >
      <View style={styles.legalIcon}>
        <Icon name={icon} size={18} color={m3.primary} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.legalTitle}>{title}</Text>
        <Text style={styles.legalDetail}>{detail}</Text>
      </View>
      <Icon name="chevron_right" size={18} color={m3.outline} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  disabled: { opacity: 0.5 },
  rowPressed: { backgroundColor: m3.surfaceContainerLow },

  titleBlock: { gap: 2 },
  eyebrow: { ...m3Type.labelSm, color: m3.secondary, letterSpacing: 0.6 },
  title: { ...m3Type.headlineMd, color: m3.onSurface, marginTop: 2 },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },

  card: { gap: m3Space.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  cardIcon: { width: 40, height: 40, borderRadius: m3Radius.md, backgroundColor: 'rgba(171,45,25,0.10)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...m3Type.titleMd, color: m3.onSurface },
  body: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  ownedList: { gap: 6 },
  ownedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ownedText: { ...m3Type.bodySm, color: m3.onSurface, flex: 1 },

  primaryBtn: { height: 46, borderRadius: m3Radius.md, backgroundColor: m3.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { ...m3Type.labelLg, color: m3.onPrimary },

  sectionTitle: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.6, paddingHorizontal: 2, marginTop: 4 },
  menuCard: { paddingHorizontal: m3Space.md },
  legalRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, paddingVertical: 10 },
  legalBorder: { borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh },
  legalIcon: { width: 36, height: 36, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  legalTitle: { ...m3Type.labelLg, color: m3.onSurface },
  legalDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
});
