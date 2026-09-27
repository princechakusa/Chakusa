import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { TeamMemberDto } from '../apiTypes';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { combineLocalDateTime, localDateKey } from '../domain/calendar';
import { ApiError } from '../services/api';
import { availabilityApi, BookingBlockDto, teamApi } from '../services/endpoints';
import { m3, m3Radius, m3Shadow, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';

export function AvailabilitySettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [blocks, setBlocks] = useState<BookingBlockDto[]>([]);
  const [members, setMembers] = useState<TeamMemberDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [date, setDate] = useState(localDateKey(new Date()));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [memberId, setMemberId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 120);
    try {
      const [items, team] = await Promise.all([availabilityApi.blocks(from.toISOString(), to.toISOString()), teamApi.listMembers()]);
      setBlocks(items);
      setMembers(team.filter((item) => item.status === 'ACTIVE'));
      setError(null);
    } catch {
      setError('Could not load blocked time.');
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const startsAt = combineLocalDateTime(date, start);
    const endsAt = combineLocalDateTime(date, end);
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
      setError('Enter a valid date and end time after the start.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await availabilityApi.createBlock({ assignedMemberId: memberId || null, startsAt, endsAt, reason: reason.trim() || null });
      setCreating(false);
      setReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not block this time.');
    } finally {
      setSaving(false);
    }
  };
  const remove = (block: BookingBlockDto) =>
    Alert.alert('Remove blocked time?', 'This time will become available for booking again.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void availabilityApi.deleteBlock(block.id).then(load).catch(() => setError('Could not remove blocked time.')) },
    ]);

  const header = <M3Header businessName="Availability" onBack={() => navigation.goBack()} />;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      <M3Screen header={header}>
        <View style={styles.titleWrap}>
          <Text style={styles.eyebrow}>SCHEDULE</Text>
          <Text style={styles.title}>Booking Availability</Text>
          <Text style={styles.subtitle}>Set business hours in your profile, then block holidays, leave, or unavailable time here.</Text>
        </View>

        {!loaded ? (
          <M3Loading label="Loading availability…" />
        ) : blocks.length ? (
          <View style={styles.list}>
            {blocks.map((block) => {
              const member = block.assignedMemberId ? members.find((item) => item.id === block.assignedMemberId)?.name ?? 'Team member' : 'Whole business';
              return (
                <M3Card key={block.id} style={styles.blockCard}>
                  <View style={styles.blockIcon}>
                    <Icon name="event_busy" size={20} color={m3.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.blockTitle}>{block.reason ?? 'Unavailable'}</Text>
                    <Text style={styles.blockMeta}>
                      {new Date(block.startsAt).toLocaleString()} – {new Date(block.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                    <Text style={styles.blockMeta}>{member}</Text>
                  </View>
                  <Pressable accessibilityRole="button" onPress={() => remove(block)} style={styles.removeBtn}>
                    <Icon name="delete_outline" size={18} color={m3.error} />
                  </Pressable>
                </M3Card>
              );
            })}
          </View>
        ) : (
          <M3Empty icon="event_available" title="No blocked time" message="Your working hours are available unless an appointment already occupies a slot." />
        )}

        {creating ? (
          <M3Card style={styles.form}>
            <Text style={styles.formHeading}>Block time</Text>
            <Field label="Date (YYYY-MM-DD)" value={date} onChange={setDate} />
            <View style={styles.row}>
              <View style={styles.flex}>
                <Field label="Start" value={start} onChange={setStart} />
              </View>
              <View style={styles.flex}>
                <Field label="End" value={end} onChange={setEnd} />
              </View>
            </View>
            <Text style={styles.label}>Applies to</Text>
            <View style={styles.choices}>
              <Pressable accessibilityRole="button" onPress={() => setMemberId('')}>
                <Chip label="Whole business" selected={!memberId} />
              </Pressable>
              {members.map((member) => (
                <Pressable key={member.id} accessibilityRole="button" onPress={() => setMemberId(member.id)}>
                  <Chip label={member.name} selected={memberId === member.id} />
                </Pressable>
              ))}
            </View>
            <Field label="Reason (optional)" value={reason} onChange={setReason} />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <PrimaryButton fullWidth disabled={saving} label={saving ? 'Saving…' : 'Block time'} onPress={() => void create()} />
            <SecondaryButton fullWidth disabled={saving} label="Cancel" onPress={() => setCreating(false)} />
          </M3Card>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={styles.addBtn}>
            <Icon name="add" size={18} color={m3.onPrimary} />
            <Text style={styles.addText}>Block unavailable time</Text>
          </Pressable>
        )}
      </M3Screen>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholderTextColor={m3.onSurfaceVariant} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { gap: m3Space.sm },

  titleWrap: { gap: 2 },
  eyebrow: { ...m3Type.labelSm, color: m3.secondary, letterSpacing: 0.6 },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },

  blockCard: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  blockIcon: { width: 42, height: 42, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  blockTitle: { ...m3Type.titleMd, color: m3.onSurface },
  blockMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  removeBtn: { width: 36, height: 36, borderRadius: m3Radius.sm, backgroundColor: m3.errorContainer, alignItems: 'center', justifyContent: 'center' },

  form: { gap: m3Space.sm, ...m3Shadow.raised },
  formHeading: { ...m3Type.titleMd, color: m3.onSurface },
  fieldWrap: { gap: 4 },
  label: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  input: { minHeight: 46, backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.md, paddingHorizontal: m3Space.sm, ...m3Type.bodyMd, color: m3.onSurface },
  row: { flexDirection: 'row', gap: m3Space.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },
  error: { ...m3Type.bodySm, color: m3.error },

  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: m3Radius.md, backgroundColor: m3.primary },
  addText: { ...m3Type.labelLg, color: m3.onPrimary },
});
