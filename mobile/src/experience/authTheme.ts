import { Platform } from 'react-native';

// PROGRAM 3: a dedicated, premium design language for the entry surfaces
// (welcome + both auth screens). Deliberately separate from the app-wide
// `theme.ts` so these screens can carry a more considered typographic and
// tonal system without disturbing the rest of the product.

export const authColors = {
  bg: '#FBFAF8',
  bgSunk: '#F4F1ED',
  surface: '#FFFFFF',
  ink: '#0E1116',
  inkSoft: '#5C6472',
  inkFaint: '#8B93A1',
  coral: '#EE5D43',
  coralPressed: '#D94A31',
  coralSoft: '#FFF1EE',
  line: '#ECE7E1',
  lineSoft: '#F4EFE9',
  onCoral: '#FFFFFF',
  positive: '#0E9F6E',
  danger: '#D64545',
} as const;

export const authFont = {
  display: 'PlusJakartaSans_800ExtraBold',
  heading: 'PlusJakartaSans_700Bold',
  semibold: 'PlusJakartaSans_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
} as const;

export const authType = {
  display: { fontFamily: authFont.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: authColors.ink },
  title: { fontFamily: authFont.heading, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, color: authColors.ink },
  cardTitle: { fontFamily: authFont.heading, fontSize: 18, lineHeight: 24, letterSpacing: -0.2, color: authColors.ink },
  bodyLg: { fontFamily: authFont.body, fontSize: 15, lineHeight: 23, color: authColors.inkSoft },
  body: { fontFamily: authFont.body, fontSize: 14, lineHeight: 21, color: authColors.inkSoft },
  label: { fontFamily: authFont.bodySemibold, fontSize: 14, lineHeight: 18, color: authColors.ink },
  link: { fontFamily: authFont.bodySemibold, fontSize: 13, lineHeight: 18, color: authColors.coral },
  micro: { fontFamily: authFont.bodySemibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.7, color: authColors.inkFaint },
} as const;

export const authRadius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;
export const authSpace = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 22, xl: 30, xxl: 40 } as const;

export const authShadow = {
  card: Platform.select({
    ios: { shadowColor: '#1A1207', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 14 } },
    android: { elevation: 3 },
    default: { boxShadow: '0 14px 34px rgba(26,18,7,0.08)' },
  }),
  cta: Platform.select({
    ios: { shadowColor: authColors.coral, shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
    android: { elevation: 4 },
    default: { boxShadow: '0 10px 24px rgba(238,93,67,0.32)' },
  }),
} as const;
