import { describe, expect, it } from 'vitest';
import { recoveryNextStep, recoveryPriority, recoveryPriorityLabel, recoverySourceLabel } from './recovery';

describe('recovery presentation rules', () => {
  it('uses a readable, source-aware label', () => {
    expect(recoverySourceLabel('missed_call')).toBe('Missed call');
    expect(recoverySourceLabel('web-form')).toBe('Web Form');
    expect(recoverySourceLabel(null)).toBe('Customer opportunity');
  });

  it('prioritizes new urgent work without changing lead data', () => {
    expect(recoveryPriority({ status: 'new', urgency: 'high' })).toBe('high');
    expect(recoveryPriorityLabel('high')).toBe('Act now');
    expect(recoveryPriority({ status: 'won', urgency: 'low' })).toBe('standard');
  });

  it('always gives the owner a truthful next step', () => {
    expect(recoveryNextStep({ status: 'new', generatedReply: null }).action).toBe('Prepare message');
    expect(recoveryNextStep({ status: 'new', generatedReply: 'Hello' }).action).toBe('Open message');
    expect(recoveryNextStep({ status: 'contacted', generatedReply: null }).action).toBe('Update status');
    expect(recoveryNextStep({ status: 'won', generatedReply: null }).title).toBe('Recovered');
  });
});
