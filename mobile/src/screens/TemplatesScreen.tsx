import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MessageTone, MessageType } from '../apiTypes';
import { ApiError } from '../services/api';
import { templatesApi } from '../services/endpoints';
import { useAppState } from '../state/AppContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { RootStackParamList } from '../types';
import { titleCase } from '../utils/format';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen, SectionTitle } from '../experience/businessKit';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';

const types: MessageType[] = [
  'missed_call',
  'booking_confirmation',
  'review_request',
  'private_feedback',
  'comeback_reminder',
  'custom',
  'public_profile_inquiry',
  'lead_follow_up',
];
const tones: MessageTone[] = ['friendly', 'professional', 'casual'];

const TYPE_ICON: Partial<Record<MessageType, string>> = {
  missed_call: 'call_missed',
  booking_confirmation: 'confirmation_number',
  review_request: 'star',
  private_feedback: 'feedback',
  comeback_reminder: 'history',
  custom: 'edit_note',
  public_profile_inquiry: 'storefront',
  lead_follow_up: 'campaign',
};

export function TemplatesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { templates, state, loadTemplates } = useAppState();
  const { usage, refresh: refreshPlan } = usePlanExperience();
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(() => templates.find((item) => item.id === activeId) ?? templates[0] ?? null, [activeId, templates]);
  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [tone, setTone] = useState<MessageTone>('friendly');
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<MessageType>('missed_call');
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('Hi {{customer_name}}, this is {{business_name}}.');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);
  useEffect(() => {
    if (active) {
      setActiveId(active.id);
      setBody(active.body);
      setName(active.name);
      setTone(active.tone);
    }
  }, [active]);

  const save = async () => {
    if (!active || saving) return;
    setSaving(true);
    setError(null);
    try {
      await templatesApi.patch(active.id, { name: name.trim(), body: body.trim(), tone });
      await loadTemplates();
      Alert.alert('Template saved', 'The persisted template was reloaded from CHAKUSA.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to save template.');
    } finally {
      setSaving(false);
    }
  };
  const create = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await templatesApi.create({ templateType: newType, name: newName.trim(), body: newBody.trim(), tone, isDefault: true });
      void refreshPlan();
      setCreating(false);
      await loadTemplates();
      setActiveId(created.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to create template.');
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <M3Header
      businessName="Message templates"
      onBack={() => navigation.goBack()}
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
    />
  );

  return (
    <>
      <M3Screen header={header}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text style={styles.title}>Booking templates</Text>
            <Text style={styles.subtitle}>Persisted templates for manual follow-up</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={styles.addBtn}>
            <Icon name="add" size={17} color={m3.onPrimary} />
            <Text style={styles.addText}>Template</Text>
          </Pressable>
        </View>

        {!state.templates.loaded && state.templates.loading ? (
          <M3Loading label="Loading templates…" />
        ) : state.templates.error ? (
          <M3Error message={state.templates.error} onRetry={() => void loadTemplates()} />
        ) : !templates.length ? (
          <M3Empty icon="forum" title="No custom templates" message="Create one, or CHAKUSA will use the backend’s industry defaults." />
        ) : (
          <>
            <SectionTitle title="TEMPLATES" />
            <View style={styles.list}>
              {templates.map((template) => {
                const isActive = active?.id === template.id;
                return (
                  <Pressable key={template.id} accessibilityRole="button" onPress={() => setActiveId(template.id)}>
                    <M3Card style={[styles.templateCard, isActive && styles.templateCardActive]}>
                      <View style={styles.templateIcon}>
                        <Icon name={TYPE_ICON[template.templateType] ?? 'description'} size={18} color={m3.primary} />
                      </View>
                      <View style={styles.flex}>
                        <Text numberOfLines={1} style={styles.templateName}>{template.name}</Text>
                        <Text style={styles.templateMeta}>
                          {titleCase(template.templateType)} · {titleCase(template.tone)}
                        </Text>
                      </View>
                      {isActive ? <Chip label="Editing" tone="secondary" /> : null}
                    </M3Card>
                  </Pressable>
                );
              })}
            </View>

            {active ? (
              <M3Card style={styles.editorCard}>
                <Text style={styles.label}>Name</Text>
                <TextInput value={name} onChangeText={setName} style={styles.input} />
                <Text style={styles.label}>Body</Text>
                <TextInput
                  multiline
                  value={body}
                  onChangeText={setBody}
                  style={styles.editor}
                  textAlignVertical="top"
                />
                <Text style={styles.helper}>
                  Variables: {'{{customer_name}}'} · {'{{business_name}}'} · {'{{service_name}}'} · {'{{booking_time}}'} · {'{{review_link}}'} · {'{{phone_number}}'}
                </Text>
                <Text style={styles.label}>Tone</Text>
                <Choices options={tones} value={tone} onChange={(value) => setTone(value as MessageTone)} />
              </M3Card>
            ) : null}
          </>
        )}

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {active ? (
          <Pressable
            accessibilityRole="button"
            disabled={saving || !name.trim() || !body.trim()}
            onPress={() => void save()}
            style={[styles.primaryBtn, (saving || !name.trim() || !body.trim()) && styles.primaryBtnDisabled]}
          >
            <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save template'}</Text>
          </Pressable>
        ) : null}
      </M3Screen>

      <Modal visible={creating} transparent animationType="slide" onRequestClose={() => setCreating(false)}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.overlay} onPress={() => !saving && setCreating(false)}>
            <Pressable style={styles.sheet} onPress={() => undefined}>
              <Text style={styles.sheetTitle}>New template</Text>
              <Text style={styles.label}>Type</Text>
              <Choices options={types} value={newType} onChange={(value) => setNewType(value as MessageType)} />
              {usage ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setCreating(false);
                    navigation.navigate('Pro');
                  }}
                >
                  <Text style={styles.helper}>
                    {usage.customTemplates.limitPerType === null
                      ? 'Unlimited custom templates for this type.'
                      : `${usage.customTemplates.usageByType[newType]} of ${usage.customTemplates.limitPerType} custom template${usage.customTemplates.limitPerType === 1 ? '' : 's'} used for this type.`}
                  </Text>
                </Pressable>
              ) : null}
              <Text style={styles.label}>Name</Text>
              <TextInput value={newName} onChangeText={setNewName} style={styles.input} />
              <Text style={styles.label}>Body</Text>
              <TextInput multiline value={newBody} onChangeText={setNewBody} style={styles.editor} textAlignVertical="top" />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                accessibilityRole="button"
                disabled={saving || !newName.trim() || !newBody.trim()}
                onPress={() => void create()}
                style={[styles.primaryBtn, (saving || !newName.trim() || !newBody.trim()) && styles.primaryBtnDisabled]}
              >
                <Text style={styles.primaryBtnText}>{saving ? 'Creating…' : 'Create template'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => setCreating(false)} style={styles.ghostWide}>
                <Text style={styles.ghostWideText}>Cancel</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function Choices({ options, value, onChange }: { options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.choices}>
      {options.map((option) => (
        <Chip
          key={option}
          label={titleCase(option)}
          selected={value === option}
          onPress={() => onChange(option)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.primary },
  addText: { ...m3Type.labelMd, color: m3.onPrimary },

  list: { gap: m3Space.xs },
  templateCard: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  templateCardActive: { borderWidth: 1.5, borderColor: m3.primary },
  templateIcon: { width: 38, height: 38, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  templateName: { ...m3Type.labelLg, color: m3.onSurface },
  templateMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },

  editorCard: { gap: 4 },
  label: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.4, marginTop: m3Space.sm, marginBottom: 4 },
  input: {
    minHeight: 48,
    backgroundColor: m3.surfaceContainerLow,
    borderRadius: m3Radius.md,
    paddingHorizontal: m3Space.md,
    ...m3Type.bodyMd,
    color: m3.onSurface,
  },
  editor: {
    minHeight: 150,
    backgroundColor: m3.surfaceContainerLow,
    borderRadius: m3Radius.md,
    padding: m3Space.md,
    ...m3Type.bodyMd,
    color: m3.onSurface,
  },
  helper: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: m3Space.xs },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  error: { ...m3Type.bodySm, color: m3.error },

  primaryBtn: { height: 48, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
  ghostWide: { height: 44, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  ghostWideText: { ...m3Type.labelMd, color: m3.onSurface },

  overlay: { flex: 1, backgroundColor: 'rgba(19,27,46,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: m3.surfaceContainerLowest, borderTopLeftRadius: m3Radius.xl, borderTopRightRadius: m3Radius.xl, padding: m3Space.lg, paddingBottom: 40, gap: 2, maxHeight: '88%' },
  sheetTitle: { ...m3Type.headlineSm, color: m3.onSurface },
});
