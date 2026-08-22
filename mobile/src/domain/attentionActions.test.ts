import { describe, expect, it } from 'vitest';
import { attentionActionsFor } from './attentionActions';

describe('attentionActionsFor', () => {
  it('offers only View when there is no phone and no message', () => {
    const actions = attentionActionsFor({ category: 'missed_call_followup', customerPhone: null, message: null });
    expect(actions.map(a => a.kind)).toEqual(['view']);
  });

  it('offers Call when a phone number exists, even without a message', () => {
    const actions = attentionActionsFor({ category: 'missed_call_followup', customerPhone: '+263771234567', message: null });
    expect(actions.map(a => a.kind)).toEqual(['call', 'view']);
  });

  it('offers WhatsApp only when both a phone and a pre-rendered message exist', () => {
    const actions = attentionActionsFor({ category: 'missed_call_followup', customerPhone: '+263771234567', message: 'Hi there!' });
    expect(actions.map(a => a.kind)).toEqual(['call', 'whatsapp', 'view']);
  });

  it('never offers WhatsApp from a message alone, without a phone number', () => {
    const actions = attentionActionsFor({ category: 'missed_call_followup', customerPhone: null, message: 'Hi there!' });
    expect(actions.map(a => a.kind)).not.toContain('whatsapp');
  });

  it('offers Mark done for a customer_due item regardless of phone/message', () => {
    const actions = attentionActionsFor({ category: 'customer_due', customerPhone: null, message: null });
    expect(actions.map(a => a.kind)).toEqual(['markDone', 'view']);
  });

  it('offers Mark sent for a review_opportunity item only when a message already exists', () => {
    const withMessage = attentionActionsFor({ category: 'review_opportunity', customerPhone: null, message: 'Please review us!' });
    const withoutMessage = attentionActionsFor({ category: 'review_opportunity', customerPhone: null, message: null });
    expect(withMessage.map(a => a.kind)).toContain('markSent');
    expect(withoutMessage.map(a => a.kind)).not.toContain('markSent');
  });

  it('offers Mark paid for a payment_outstanding item unconditionally', () => {
    const actions = attentionActionsFor({ category: 'payment_outstanding', customerPhone: null, message: null });
    expect(actions.map(a => a.kind)).toEqual(['markPaid', 'view']);
  });

  it('always includes View as the last action, as a fallback', () => {
    const actions = attentionActionsFor({ category: 'payment_outstanding', customerPhone: '+263771234567', message: 'x' });
    expect(actions[actions.length - 1].kind).toBe('view');
  });
});
