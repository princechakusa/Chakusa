import { AttentionItemDto } from '../apiTypes';

/**
 * Which quick actions an Attention Center row can offer, derived purely
 * from the item's own data — never inventing a workflow the rest of the
 * product doesn't already support. `call`/`whatsapp` only appear when
 * there's a real phone number (and, for whatsapp, a real pre-rendered
 * message — never generated here, see attentionCenter.service.ts's doc
 * comment). The category-specific completion action
 * (`markDone`/`markSent`/`markPaid`) reuses the exact endpoint its own
 * detail screen already calls; there is no new business logic here, only
 * a decision about which existing action applies to which item.
 *
 * `view` is always offered as the fallback to the full detail screen —
 * useful whenever a quick action isn't available yet (e.g. no message
 * prepared) or the owner wants more context before acting.
 */
export type AttentionActionKind = 'call' | 'whatsapp' | 'markDone' | 'markSent' | 'markPaid' | 'view';

export interface AttentionAction {
  kind: AttentionActionKind;
  label: string;
}

export function attentionActionsFor(item: Pick<AttentionItemDto, 'category' | 'customerPhone' | 'message'>): AttentionAction[] {
  const actions: AttentionAction[] = [];
  const hasPhone = Boolean(item.customerPhone);
  const hasMessage = Boolean(item.message);

  if (hasPhone) actions.push({ kind: 'call', label: 'Call' });
  if (hasPhone && hasMessage) actions.push({ kind: 'whatsapp', label: 'WhatsApp' });

  if (item.category === 'customer_due') actions.push({ kind: 'markDone', label: 'Mark done' });
  if (item.category === 'review_opportunity' && hasMessage) actions.push({ kind: 'markSent', label: 'Mark sent' });
  if (item.category === 'payment_outstanding') actions.push({ kind: 'markPaid', label: 'Mark paid' });

  actions.push({ kind: 'view', label: 'View' });
  return actions;
}
