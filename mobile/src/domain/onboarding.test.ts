import { describe, expect, it } from 'vitest';
import { clampOnboardingStep, GOAL_COPY, nextOnboardingStep, ONBOARDING_STEP, onboardingProgressLabel, onboardingProgressPercent, previousOnboardingStep, primaryGoalCopy, toggleGoal } from './onboarding';

describe('onboarding step sequence', () => {
  it('keeps welcome and auth at their original indices so AuthContext resets still land on goals', () => {
    expect(ONBOARDING_STEP.welcome).toBe(0);
    expect(ONBOARDING_STEP.auth).toBe(1);
    expect(ONBOARDING_STEP.goals).toBe(2);
  });

  it('advances one step at a time and never passes the completion step', () => {
    expect(nextOnboardingStep(ONBOARDING_STEP.setupScore)).toBe(ONBOARDING_STEP.complete);
    expect(nextOnboardingStep(ONBOARDING_STEP.complete)).toBe(ONBOARDING_STEP.complete);
  });

  it('never lets an authenticated user step back before goals, or an anonymous user before welcome', () => {
    expect(previousOnboardingStep(ONBOARDING_STEP.goals, true)).toBe(ONBOARDING_STEP.goals);
    expect(previousOnboardingStep(ONBOARDING_STEP.industry, true)).toBe(ONBOARDING_STEP.goals);
    expect(previousOnboardingStep(ONBOARDING_STEP.welcome, false)).toBe(ONBOARDING_STEP.welcome);
    expect(previousOnboardingStep(ONBOARDING_STEP.auth, false)).toBe(ONBOARDING_STEP.welcome);
  });

  it('clamps a restored step into the valid range for the current auth state', () => {
    expect(clampOnboardingStep(0, true)).toBe(ONBOARDING_STEP.goals);
    expect(clampOnboardingStep(999, true)).toBe(ONBOARDING_STEP.complete);
    expect(clampOnboardingStep(-5, false)).toBe(ONBOARDING_STEP.welcome);
  });

  it('formats progress as "N of TOTAL" across the full range, capped at the last progress step', () => {
    expect(onboardingProgressLabel(1)).toBe('1 of 10');
    expect(onboardingProgressLabel(ONBOARDING_STEP.setupScore)).toBe('10 of 10');
    expect(onboardingProgressLabel(ONBOARDING_STEP.complete)).toBe('10 of 10');
  });

  it('maps progress percent proportionally and never exceeds 100', () => {
    expect(onboardingProgressPercent(1)).toBeCloseTo(10);
    expect(onboardingProgressPercent(ONBOARDING_STEP.setupScore)).toBe(100);
    expect(onboardingProgressPercent(ONBOARDING_STEP.complete)).toBe(100);
  });

  it('toggles a goal in and out of the selection immutably', () => {
    const selected = toggleGoal([], 'reviews');
    expect(selected).toEqual(['reviews']);
    expect(toggleGoal(selected, 'reviews')).toEqual([]);
    expect(selected).toEqual(['reviews']);
  });

  it('surfaces the first selected goal as personalized copy, or null when none is selected', () => {
    expect(primaryGoalCopy(['comebacks', 'reviews'])).toBe(GOAL_COPY.comebacks.label);
    expect(primaryGoalCopy([])).toBeNull();
  });

  it('defines copy for every goal option', () => {
    expect(Object.keys(GOAL_COPY)).toEqual(['missed_calls', 'reviews', 'comebacks']);
  });
});
