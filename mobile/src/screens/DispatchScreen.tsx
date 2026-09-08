import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { DispatchApptDto, DispatchBoardDto, DispatchCandidateDto, dispatchApi } from '../services/endpoints';
import { localDateKey } from '../domain/calendar';
import { ApiError } from '../services/api';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const ARRIVAL_LABEL: Record<string, string> = { ON_MY_WAY: 'On my way', RUNNING_LATE: 'Running late', ARRIVED: 'Arrived' };

function hoursLabel(minutes: number) {
  if (!minutes) return 'Open day';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h}h ` : ''}${m ? `${m}m ` : ''}booked`.trim();
}
function clockLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function dayLabel(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function DispatchScreen() {
  const navigation = useNavigation<Nav>();
  const [day, setDay] = useState(() => new Date());
  const [board, setBoard] = useState<DispatchBoardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<DispatchApptDto | null>(null);
  const [candidates, setCandidates] = useState<DispatchCandidateDto[] | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const dateKey = localDateKey(day);

  const load = useCallback(async (soft = false) => {
    soft ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setBoard(await dispatchApi.board(dateKey));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the dispatch board.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateKey]);

  useEffect(() => { void load(); }, [load]);

  const openAssign = async (appt: DispatchApptDto) => {
    setAssignFor(appt);
    setCandidates(null);
    setAssignError(null);
    try {
      setCandidates(await dispatchApi.candidates(appt.id));
    } catch (caught) {
      setAssignError(caught instanceof Error ? caught.message : 'Unable to load available team members.');
    }
  };

  const assign = async (memberId: string) => {
    if (!assignFor || assigning) return;
    setAssigning(true);
    setAssignError(null);
    try {
      await dispatchApi.assign(assignFor.id, memberId);
      setAssignFor(null);
      setCandidates(null);
      await load(true);
    } catch (caught) {
      setAssignError(caught instanceof ApiError ? caught.message : 'Unable to assign this appointment.');
    } finally {
      setAssigning(false);
    }
  };

  const header = <M3Header businessName="Dispatch" onBack={() => navigation.goBack()} onNotificationsPress={() => navigation.navigate('AttentionCenter')} hasNotifications={false} />;

  return (
    <M3Screen header={header} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={m3.primary} />}>
      <View style={styles.dateRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => setDay(d => new Date(d.getTime() - 86400000))} style={styles.dateBtn}>
          <Icon name="chevron_left" size={22} color={m3.onSurface} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.dateTitle}>{dayLabel(day)}</Text>
          <Text style={styles.dateSub}>{board ? `${board.members.length} on the team` : ' '}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Next day" onPress={() => setDay(d => new Date(d.getTime() + 86400000))} style={styles.dateBtn}>
          <Icon name="chevron_right" size={22} color={m3.onSurface} />
        </Pressable>
      </View>

      {loading ? <M3Loading label="Loading dispatch..." /> : error ? <M3Error message={error} onRetry={() => void load()} /> : board ? (
        <View style={styles.stack}>
          <View>
            <Text style={styles.sectionLabel}>UNASSIGNED</Text>
            {board.unassigned.length === 0 ? (
              <M3Empty icon="task_alt" title="Everything is assigned" message="No appointments are waiting for a team member on this day." />
            ) : board.unassigned.map(appt => (
              <M3Card key={appt.id} style={styles.apptCard}>
                <View style={styles.apptTop}>
                  <Text style={styles.apptTime}>{clockLabel(appt.startsAt)}</Text>
                  <Text style={styles.apptDur}>{appt.durationMinutes}m</Text>
                </View>
                <Text style={styles.apptName}>{appt.serviceName}</Text>
                {appt.customerName ? <Text style={styles.apptMeta}>{appt.customerName}</Text> : null}
                <Pressable accessibilityRole="button" onPress={() => void openAssign(appt)} style={styles.assignBtn}>
                  <Icon name="person_add" size={16} color={m3.onPrimary} />
                  <Text style={styles.assignBtnText}>Assign</Text>
                </Pressable>
              </M3Card>
            ))}
          </View>

          <View>
            <Text style={styles.sectionLabel}>TEAM</Text>
            {board.members.map(member => (
              <M3Card key={member.id} style={styles.memberCard}>
                <View style={styles.memberTop}>
                  <View style={styles.flex}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.apptMeta}>{hoursLabel(member.bookedMinutes)}</Text>
                  </View>
                  <Chip label={member.onDuty ? 'On duty' : 'Off'} tone={member.onDuty ? 'secondary' : 'neutral'} />
                </View>
                {member.appointments.length === 0 ? (
                  <Text style={styles.emptyLine}>No appointments</Text>
                ) : member.appointments.map(appt => (
                  <View key={appt.id} style={styles.memberApptRow}>
                    <Text style={styles.memberApptTime}>{clockLabel(appt.startsAt)}</Text>
                    <View style={styles.flex}>
                      <Text style={styles.memberApptName}>{appt.serviceName}</Text>
                      {appt.customerName ? <Text style={styles.apptMeta}>{appt.customerName}</Text> : null}
                    </View>
                    {appt.arrivalState ? <Chip label={ARRIVAL_LABEL[appt.arrivalState] ?? appt.arrivalState} tone="outline" /> : null}
                  </View>
                ))}
                {member.blocks.map(block => (
                  <View key={block.id} style={styles.blockRow}>
                    <Icon name="block" size={14} color={m3.onSurfaceVariant} />
                    <Text style={styles.apptMeta}>{clockLabel(block.startsAt)} to {clockLabel(block.endsAt)}{block.reason ? ` - ${block.reason}` : ''}{block.businessWide ? ' (business)' : ''}</Text>
                  </View>
                ))}
              </M3Card>
            ))}
          </View>
        </View>
      ) : null}

      <Modal visible={assignFor !== null} transparent animationType="slide" onRequestClose={() => setAssignFor(null)}>
        <Pressable style={styles.sheetOverlay} onPress={() => setAssignFor(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Assign {assignFor?.serviceName}</Text>
            {assignFor ? <Text style={styles.apptMeta}>{clockLabel(assignFor.startsAt)} to {clockLabel(assignFor.endsAt)}</Text> : null}
            {assignError ? <Text style={styles.assignError}>{assignError}</Text> : null}
            {candidates === null ? <M3Loading label="Checking availability..." /> : candidates.length === 0 ? (
              <Text style={styles.emptyLine}>No team members can provide this service.</Text>
            ) : (
              <View style={styles.candidateList}>
                {candidates.map(c => (
                  <Pressable key={c.id} disabled={assigning} accessibilityRole="button" onPress={() => void assign(c.id)} style={[styles.candidateRow, !c.available && styles.candidateRowWarn]}>
                    <View style={styles.flex}>
                      <Text style={styles.candidateName}>{c.name}</Text>
                      <Text style={styles.apptMeta}>{c.available ? 'Available' : !c.withinHours ? 'Outside working hours' : 'Has a conflict'}</Text>
                    </View>
                    {c.available ? <Icon name="check_circle" size={18} color={m3.secondary} /> : <Icon name="warning" size={18} color={m3.error} />}
                  </Pressable>
                ))}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </M3Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: m3Space.lg },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, marginBottom: m3Space.md },
  dateBtn: { width: 40, height: 40, borderRadius: m3Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: m3.surfaceContainerHigh },
  dateTitle: { ...m3Type.titleMd, color: m3.onSurface },
  dateSub: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  sectionLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.8, marginBottom: m3Space.sm },
  apptCard: { gap: m3Space.xs, marginBottom: m3Space.sm },
  apptTop: { flexDirection: 'row', justifyContent: 'space-between' },
  apptTime: { ...m3Type.labelLg, color: m3.onSurface },
  apptDur: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  apptName: { ...m3Type.bodyLg, color: m3.onSurface },
  apptMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  assignBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: m3Space.xs, marginTop: m3Space.xs, height: 40, borderRadius: m3Radius.md, backgroundColor: m3.primary },
  assignBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
  memberCard: { gap: m3Space.sm, marginBottom: m3Space.sm },
  memberTop: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  memberName: { ...m3Type.labelLg, color: m3.onSurface },
  emptyLine: { ...m3Type.bodySm, color: m3.onSurfaceVariant, fontStyle: 'italic' },
  memberApptRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, paddingVertical: m3Space.xs, borderTopWidth: 1, borderTopColor: m3.outlineVariant },
  memberApptTime: { ...m3Type.bodyMd, color: m3.onSurface, width: 68 },
  memberApptName: { ...m3Type.bodyMd, color: m3.onSurface },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.xs },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(19,27,46,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: m3.surfaceContainerHigh, borderTopLeftRadius: m3Radius.xl, borderTopRightRadius: m3Radius.xl, padding: m3Space.lg, gap: m3Space.sm },
  sheetTitle: { ...m3Type.titleMd, color: m3.onSurface },
  candidateList: { gap: m3Space.xs, marginTop: m3Space.sm },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, padding: m3Space.md, borderRadius: m3Radius.md, backgroundColor: m3.surface },
  candidateRowWarn: { backgroundColor: m3.errorContainer },
  candidateName: { ...m3Type.bodyLg, color: m3.onSurface },
  assignError: { ...m3Type.bodySm, color: m3.error },
});
