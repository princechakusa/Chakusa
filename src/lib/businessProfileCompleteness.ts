/**
 * How complete a business's own record is — a distinct question from
 * mobile's setupScore.ts (which also checks on-device state: push
 * permission, automation configuration). This is the backend-only subset:
 * fields that live entirely in the Business row, so it can be computed
 * here and reused by both computeBusinessHealth (as one health component)
 * and generateRecommendations (as an actionable "finish your profile"
 * prompt) without either duplicating the mobile checklist or needing any
 * device-state the backend never receives.
 */
export interface BusinessProfileCompletenessInput {
  industry: string | null;
  phone: string | null;
  description: string | null;
  defaultServices: unknown;
  workingHoursSummary: string | null;
  googleReviewLink: string | null;
}

const CHECKLIST_FIELDS = ["industry", "phone", "description", "defaultServices", "workingHours", "googleReviewLink"] as const;

export function computeBusinessProfileCompleteness(input: BusinessProfileCompletenessInput): number {
  const checks = [
    Boolean(input.industry?.trim()),
    Boolean(input.phone?.trim()),
    Boolean(input.description?.trim()),
    Array.isArray(input.defaultServices) && input.defaultServices.length > 0,
    Boolean(input.workingHoursSummary?.trim()),
    Boolean(input.googleReviewLink?.trim()),
  ];
  return checks.filter(Boolean).length / CHECKLIST_FIELDS.length;
}
