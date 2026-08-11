import { Platform } from 'react-native';

export const colors = {
  primary: '#FF5C5C', primaryPressed: '#E95C62', primarySoft: '#F8F9FB',
  success: '#35D0BA', successSoft: '#F8F9FB', attention: '#F5B942', attentionSoft: '#F8F9FB',
  negative: '#E95C62', negativeSoft: '#F8F9FB', background: '#F8F9FB', surface: '#FFFFFF',
  text: '#20242B', textSecondary: '#737985', border: '#E8EAF0', divider: '#EFF0F3',
  tabInactive: '#9298A3', overlay: 'rgba(32,36,43,0.42)',
} as const;

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40 } as const;
export const radius = { sm: 6, md: 8, lg: 12, xl: 16, round: 999 } as const;
export const typography = {
  hero: { fontSize: 34, lineHeight: 40, fontWeight: '700' as const },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const },
  subheading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '700' as const },
} as const;
export const shadows = { card: Platform.select({
  ios: { shadowColor: '#20242B', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 2 }, default: { boxShadow: '0 4px 12px rgba(32,36,43,0.07)' },
}) };
