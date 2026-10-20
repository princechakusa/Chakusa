import { Platform } from 'react-native';

// Premium customer palette - the deep-green / warm-cream language of the
// approved welcome screen (experience/ExperienceSelectScreen.tsx), shared by
// Explore, the business page and Messages.

export const premium = {
  bg: '#F6F4EF',
  card: '#FFFDF9',
  ink: '#182B29',
  inkSoft: '#5F6B66',
  inkFaint: '#8C948E',
  deep: '#182F2D',
  deepSoft: '#2A443F',
  onDeep: '#F6F4E9',
  onDeepSoft: '#BBC8C0',
  sage: '#E1E7D8',
  sageSoft: '#EEF1E8',
  line: '#E2E4DA',
  gold: '#C8963E',
  danger: '#C2483A',
  google: '#4285F4',
} as const;

export const premiumSerif = Platform.OS === 'ios' ? 'Georgia' : 'serif';

export const premiumShadow = Platform.select({
  ios: { shadowColor: '#0F1F1C', shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  android: { elevation: 6 },
  default: { boxShadow: '0 8px 24px rgba(15,31,28,0.14)' },
}) as object;

/** "4.8" with one decimal, or null. */
export function ratingText(rating: number | null | undefined) {
  return typeof rating === 'number' && Number.isFinite(rating) ? rating.toFixed(1) : null;
}

/** Short review-count label: 7 reviews, 1.2k reviews. */
export function reviewCountText(count: number) {
  const n = count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count);
  return `${n} review${count === 1 ? '' : 's'}`;
}
