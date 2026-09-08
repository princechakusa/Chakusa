import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../state/AuthContext';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import {
  InventoryItemDetailDto,
  InventoryItemDto,
  InventoryMovementDto,
  InventoryMovementKind,
  inventoryApi,
} from '../services/endpoints';
import { ApiError } from '../services/api';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const KIND_LABEL: Record<string, string> = {
  OPENING: 'Opening', RECEIVE: 'Received', RESTOCK: 'Restocked', CONSUME: 'Used',
  SERVICE_USE: 'Service use', WASTE: 'Waste', ADJUST: 'Adjusted', CORRECTION: 'Correction',
};
function when(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function InventoryScreen() {
  const navigation = useNavigation<Nav>();
  const { role } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const canAdjust = role === 'OWNER' || role === 'ADMIN';

  const [items, setItems] = useState<InventoryItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async (soft = false) => {
    soft ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setItems(await inventoryApi.items());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load inventory.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const header = <M3Header businessName="Inventory" onBack={() => navigation.goBack()} onNotificationsPress={() => navigation.navigate('AttentionCenter')} hasNotifications={false} />;

  return (
    <M3Screen header={header} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={m3.primary} />}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>OPERATIONS</Text>
          <Text style={styles.title}>Inventory</Text>
          <Text style={styles.sub}>Stock is the running total of an auditable movement ledger.</Text>
        </View>
        {canManage ? (
          <Pressable accessibilityRole="button" onPress={() => setAddOpen(true)} style={styles.addBtn}>
            <Icon name="add" size={16} color={m3.onPrimary} />
            <Text style={styles.addBtnText}>Item</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? <M3Loading label="Loading inventory..." /> : error ? <M3Error message={error} onRetry={() => void load()} /> : items.length === 0 ? (
        <M3Empty icon="inventory_2" title="No items yet" message={canManage ? 'Add an item to start tracking stock.' : 'Nothing is being tracked yet.'} />
      ) : (
        <View style={styles.list}>
          {items.map(item => (
            <M3Card key={item.id} onPress={() => setDetailId(item.id)} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  {item.sku ? <Text style={styles.meta}>SKU {item.sku}</Text> : null}
                </View>
                {item.lowStock ? <Chip label="Low" tone="error" /> : null}
              </View>
              <View style={styles.stockRow}>
                <Text style={styles.stockValue}>{item.currentStock}</Text>
                <Text style={styles.meta}>{item.unit ?? 'in stock'}</Text>
              </View>
            </M3Card>
          ))}
        </View>
      )}

      <AddItemModal visible={addOpen} onClose={() => setAddOpen(false)} onSaved={async () => { setAddOpen(false); await load(true); }} />
      <ItemDetailModal
        itemId={detailId}
        canAdjust={canAdjust}
        onClose={() => setDetailId(null)}
        onChanged={() => void load(true)}
      />
    </M3Screen>
  );
}

function AddItemModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [opening, setOpening] = useState('');
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (visible) { setName(''); setUnit(''); setOpening(''); setThreshold(''); setErr(null); } }, [visible]);

  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await inventoryApi.createItem({
        name: name.trim(),
        unit: unit.trim() || undefined,
        openingQuantity: opening ? Number(opening) : undefined,
        lowStockThreshold: threshold ? Number(threshold) : undefined,
      });
      await onSaved();
    } catch (caught) {
      setErr(caught instanceof ApiError ? caught.message : 'Unable to add the item.');
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>New inventory item</Text>
          <Text style={styles.label}>Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="e.g. Shampoo 1L" placeholderTextColor={m3.onSurfaceVariant} style={styles.input} />
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.label}>Unit</Text>
              <TextInput value={unit} onChangeText={setUnit} placeholder="each, ml, g" placeholderTextColor={m3.onSurfaceVariant} style={styles.input} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.label}>Opening qty</Text>
              <TextInput value={opening} onChangeText={setOpening} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={m3.onSurfaceVariant} style={styles.input} />
            </View>
          </View>
          <Text style={styles.label}>Low-stock alert at</Text>
          <TextInput value={threshold} onChangeText={setThreshold} keyboardType="decimal-pad" placeholder="optional" placeholderTextColor={m3.onSurfaceVariant} style={styles.input} />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Pressable disabled={busy} onPress={() => void save()} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{busy ? 'Saving...' : 'Add item'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const QUICK: { kind: Exclude<InventoryMovementKind, 'OPENING'>; label: string; icon: string }[] = [
  { kind: 'RECEIVE', label: 'Receive', icon: 'add_box' },
  { kind: 'CONSUME', label: 'Use', icon: 'remove_circle_outline' },
  { kind: 'WASTE', label: 'Waste', icon: 'delete_sweep' },
];

function ItemDetailModal({ itemId, canAdjust, onClose, onChanged }: { itemId: string | null; canAdjust: boolean; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<InventoryItemDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true); setErr(null);
    try { setDetail(await inventoryApi.item(itemId)); }
    catch (caught) { setErr(caught instanceof Error ? caught.message : 'Unable to load the item.'); }
    finally { setLoading(false); }
  }, [itemId]);

  useEffect(() => { if (itemId) { setQty(''); setErr(null); void load(); } else { setDetail(null); } }, [itemId, load]);

  const record = async (kind: Exclude<InventoryMovementKind, 'OPENING'>, direction?: 'increase' | 'decrease') => {
    if (!itemId || busy) return;
    const n = Number(qty);
    if (!n || n <= 0) { setErr('Enter a quantity greater than zero.'); return; }
    setBusy(true); setErr(null);
    try {
      await inventoryApi.recordMovement(itemId, { kind, quantity: n, direction });
      setQty('');
      await load();
      onChanged();
    } catch (caught) {
      setErr(caught instanceof ApiError ? caught.message : 'Unable to record the movement.');
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={itemId !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          {loading || !detail ? <M3Loading label="Loading..." /> : (
            <>
              <Text style={styles.sheetTitle}>{detail.name}</Text>
              <View style={styles.stockRow}>
                <Text style={styles.stockValue}>{detail.currentStock}</Text>
                <Text style={styles.meta}>{detail.unit ?? 'in stock'}{detail.lowStock ? '  ·  low' : ''}</Text>
              </View>

              <TextInput value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="Quantity" placeholderTextColor={m3.onSurfaceVariant} style={styles.input} />
              <View style={styles.quickRow}>
                {QUICK.map(q => (
                  <Pressable key={q.kind} disabled={busy} onPress={() => void record(q.kind)} style={styles.quickBtn}>
                    <Icon name={q.icon} size={18} color={m3.onSecondaryContainer} />
                    <Text style={styles.quickText}>{q.label}</Text>
                  </Pressable>
                ))}
              </View>
              {canAdjust ? (
                <View style={styles.quickRow}>
                  <Pressable disabled={busy} onPress={() => void record('ADJUST', 'increase')} style={styles.adjustBtn}>
                    <Text style={styles.adjustText}>Adjust +</Text>
                  </Pressable>
                  <Pressable disabled={busy} onPress={() => void record('ADJUST', 'decrease')} style={styles.adjustBtn}>
                    <Text style={styles.adjustText}>Adjust −</Text>
                  </Pressable>
                </View>
              ) : null}
              {err ? <Text style={styles.err}>{err}</Text> : null}

              <Text style={styles.label}>Recent movements</Text>
              {detail.movements.length === 0 ? (
                <Text style={styles.meta}>No movements yet.</Text>
              ) : detail.movements.map((m: InventoryMovementDto) => (
                <View key={m.id} style={styles.ledgerRow}>
                  <Text style={styles.ledgerKind}>{KIND_LABEL[m.kind] ?? m.kind}</Text>
                  <Text style={[styles.ledgerDelta, { color: Number(m.quantityDelta) < 0 ? m3.error : m3.secondary }]}>{Number(m.quantityDelta) > 0 ? '+' : ''}{m.quantityDelta}</Text>
                  <Text style={styles.meta}>{m.balanceAfter}</Text>
                  <Text style={styles.meta}>{when(m.createdAt)}</Text>
                </View>
              ))}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: m3Space.sm, marginBottom: m3Space.md },
  eyebrow: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.8 },
  title: { ...m3Type.headlineSm, color: m3.onSurface },
  sub: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: m3Space.xxs, paddingHorizontal: m3Space.sm, height: 34, borderRadius: m3Radius.full, backgroundColor: m3.primary },
  addBtnText: { ...m3Type.labelMd, color: m3.onPrimary },
  list: { gap: m3Space.sm },
  card: { gap: m3Space.xs },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  itemName: { ...m3Type.titleMd, color: m3.onSurface },
  meta: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  stockRow: { flexDirection: 'row', alignItems: 'baseline', gap: m3Space.xs },
  stockValue: { ...m3Type.headlineSm, color: m3.primary },
  overlay: { flex: 1, backgroundColor: 'rgba(19,27,46,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: m3.surfaceContainerHigh, borderTopLeftRadius: m3Radius.xl, borderTopRightRadius: m3Radius.xl, padding: m3Space.lg, gap: m3Space.sm, maxHeight: '88%' },
  sheetTitle: { ...m3Type.titleMd, color: m3.onSurface },
  label: { ...m3Type.labelMd, color: m3.onSurfaceVariant, marginTop: m3Space.xs },
  row: { flexDirection: 'row', gap: m3Space.sm },
  input: { height: 48, borderRadius: m3Radius.md, backgroundColor: m3.surface, borderWidth: 1, borderColor: m3.outlineVariant, paddingHorizontal: m3Space.md, ...m3Type.bodyLg, color: m3.onSurface },
  quickRow: { flexDirection: 'row', gap: m3Space.sm, marginTop: m3Space.xs },
  quickBtn: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: m3Space.sm, borderRadius: m3Radius.md, backgroundColor: m3.secondaryContainer },
  quickText: { ...m3Type.labelMd, color: m3.onSecondaryContainer },
  adjustBtn: { flex: 1, alignItems: 'center', paddingVertical: m3Space.sm, borderRadius: m3Radius.md, borderWidth: 1, borderColor: m3.outlineVariant },
  adjustText: { ...m3Type.labelMd, color: m3.onSurface },
  err: { ...m3Type.bodySm, color: m3.error },
  primaryBtn: { height: 48, borderRadius: m3Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: m3.primary, marginTop: m3Space.sm },
  primaryBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, paddingVertical: m3Space.xs, borderTopWidth: 1, borderTopColor: m3.outlineVariant },
  ledgerKind: { ...m3Type.bodyMd, color: m3.onSurface, flex: 1 },
  ledgerDelta: { ...m3Type.labelLg, width: 70, textAlign: 'right' },
});
