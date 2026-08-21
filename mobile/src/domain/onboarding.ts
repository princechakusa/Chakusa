export type BusinessGoal = 'missed_calls' | 'reviews' | 'comebacks';

export const GOAL_COPY: Record<BusinessGoal, { label: string; detail: string }> = {
  missed_calls: { label: 'Recover missed calls', detail: 'Follow up with customers Chakusa notices you missed.' },
  reviews: { label: 'Grow reviews', detail: 'Turn finished jobs into real Google reviews.' },
  comebacks: { label: 'Bring customers back', detail: 'Remind customers it is time to book again.' },
};

// Welcome and Auth keep indices 0-1 unchanged from the prior flow so
// AuthContext's step-2 reset (on login/restore with an incomplete business)
// still lands on the first real content step after authentication.
export const ONBOARDING_STEP = {
  welcome: 0,
  auth: 1,
  goals: 2,
  industry: 3,
  businessInfo: 4,
  phoneCountry: 5,
  services: 6,
  googleReview: 7,
  notifications: 8,
  automation: 9,
  setupScore: 10,
  complete: 11,
} as const;

// Steps 1 through setupScore are shown as "N of TOTAL" progress; welcome and
// the completion screen are excluded, matching the prior flow's convention.
export const TOTAL_PROGRESS_STEPS = ONBOARDING_STEP.setupScore;

export function onboardingProgressLabel(step: number) {
  return `${Math.max(1, Math.min(step, TOTAL_PROGRESS_STEPS))} of ${TOTAL_PROGRESS_STEPS}`;
}
export function onboardingProgressPercent(step: number) {
  return Math.min(100, Math.max(1, step) * (100 / TOTAL_PROGRESS_STEPS));
}
export function clampOnboardingStep(step: number, authenticated: boolean) {
  const min = authenticated ? ONBOARDING_STEP.goals : ONBOARDING_STEP.welcome;
  return Math.max(min, Math.min(ONBOARDING_STEP.complete, step));
}
export function nextOnboardingStep(step: number) {
  return Math.min(ONBOARDING_STEP.complete, step + 1);
}
export function previousOnboardingStep(step: number, authenticated: boolean) {
  const min = authenticated ? ONBOARDING_STEP.goals : ONBOARDING_STEP.welcome;
  return Math.max(min, step - 1);
}
export function toggleGoal(goals: BusinessGoal[], goal: BusinessGoal) {
  return goals.includes(goal) ? goals.filter(item => item !== goal) : [...goals, goal];
}
export function primaryGoalCopy(goals: BusinessGoal[]) {
  const [first] = goals;
  return first ? GOAL_COPY[first].label : null;
}
