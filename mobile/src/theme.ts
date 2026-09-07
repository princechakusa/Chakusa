import { Platform } from 'react-native';

// Chakusa shared theme - now the Material 3 "our UI" palette (rust primary,
// teal secondary, indigo-tinted neutrals) with Plus Jakarta Sans display /
// Inter text. Token NAMES are unchanged so every screen and the shared
// components/ui pick this up automatically; the businessKit primitives use
// the same values via experience/businessTheme.

export const colors = {
  primary: '#AB2D19',
  primaryPressed: '#8D1704',
  primarySoft: '#FFEDE9',
  success: '#006A61',
  successSoft: '#E3F7F3',
  attention: '#B26A00',
  attentionSoft: '#FBEEDD',
  negative: '#BA1A1A',
  negativeSoft: '#FDECEA',
  background: '#FAF8FF',
  surface: '#FFFFFF',
  text: '#131B2E',
  textSecondary: '#59413C',
  border: '#E2E7FF',
  divider: '#E7EAF7',
  tabInactive: '#8D706B',
  overlay: 'rgba(19,27,46,0.45)',
} as const;

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, round: 999 } as const;

const JAKARTA_700 = 'PlusJakartaSans_700Bold';
const JAKARTA_600 = 'PlusJakartaSans_600SemiBold';
const INTER_400 = 'Inter_400Regular';
const INTER_500 = 'Inter_500Medium';
const INTER_600 = 'Inter_600SemiBold';

export const typography = {
  hero: { fontFamily: JAKARTA_700, fontSize: 34, lineHeight: 41, letterSpacing: -0.8 },
  title: { fontFamily: JAKARTA_700, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  heading: { fontFamily: JAKARTA_700, fontSize: 20, lineHeight: 27, letterSpacing: -0.3 },
  subheading: { fontFamily: JAKARTA_600, fontSize: 17, lineHeight: 23, letterSpacing: -0.2 },
  body: { fontFamily: INTER_400, fontSize: 15, lineHeight: 23, letterSpacing: -0.08 },
  bodyStrong: { fontFamily: INTER_600, fontSize: 15, lineHeight: 23, letterSpacing: -0.08 },
  caption: { fontFamily: INTER_500, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: INTER_600, fontSize: 11, lineHeight: 14, letterSpacing: 0.3 },
} as const;

export const shadows = {
  card: Platform.select({
    ios: { shadowColor: '#131B2E', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 } },
    android: { elevation: 2 },
    default: { boxShadow: '0 3px 12px rgba(19,27,46,0.06)' },
  }),
};
