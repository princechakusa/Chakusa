// Material 3 design tokens for the business app's primary tabs
// (Dashboard, Calendar, Leads, Clients, More). Ported verbatim from the
// approved Stitch mockups: rust primary, teal secondary, indigo-tinted
// neutral surfaces, Plus Jakarta Sans display / Inter text, Material
// Symbols iconography.

export const m3 = {
  // --- primary (rust) ---
  primary: '#AB2D19',
  onPrimary: '#FFFFFF',
  primaryContainer: '#CD462E',
  onPrimaryContainer: '#FFFBFF',
  primaryFixed: '#FFDAD3',
  primaryFixedDim: '#FFB4A5',
  onPrimaryFixed: '#3F0300',
  onPrimaryFixedVariant: '#8D1704',

  // --- secondary (teal) ---
  secondary: '#006A61',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#86F2E4',
  onSecondaryContainer: '#006F66',
  secondaryFixed: '#89F5E7',
  secondaryFixedDim: '#6BD8CB',
  onSecondaryFixed: '#00201D',
  onSecondaryFixedVariant: '#005049',

  // --- tertiary (cyan) ---
  tertiary: '#00666C',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#008189',
  onTertiaryContainer: '#F4FEFF',
  tertiaryFixed: '#81F4FD',
  tertiaryFixedDim: '#63D7E0',

  // --- error ---
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#93000A',

  // --- neutral surfaces ---
  background: '#FAF8FF',
  onBackground: '#131B2E',
  surface: '#FAF8FF',
  surfaceBright: '#FAF8FF',
  surfaceDim: '#D2D9F4',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F2F3FF',
  surfaceContainer: '#EAEDFF',
  surfaceContainerHigh: '#E2E7FF',
  surfaceContainerHighest: '#DAE2FD',
  surfaceVariant: '#DAE2FD',
  onSurface: '#131B2E',
  onSurfaceVariant: '#59413C',

  outline: '#8D706B',
  outlineVariant: '#E1BFB8',

  inverseSurface: '#283044',
  inverseOnSurface: '#EEF0FF',
  inversePrimary: '#FFB4A5',
} as const;

export const m3Radius = { sm: 8, md: 12, lg: 16, xl: 20, full: 9999 } as const;

export const m3Space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 40 } as const;

const JAKARTA_600 = 'PlusJakartaSans_600SemiBold';
const JAKARTA_700 = 'PlusJakartaSans_700Bold';
const JAKARTA_800 = 'PlusJakartaSans_800ExtraBold';
const INTER_400 = 'Inter_400Regular';
const INTER_500 = 'Inter_500Medium';
const INTER_600 = 'Inter_600SemiBold';
const INTER_700 = 'Inter_700Bold';

/** Text presets. `fontFamily` already encodes weight - never also set fontWeight. */
export const m3Type = {
  displayMobile: { fontFamily: JAKARTA_700, fontSize: 36, lineHeight: 43, letterSpacing: -0.9 },
  headlineLg: { fontFamily: JAKARTA_700, fontSize: 28, lineHeight: 34, letterSpacing: -0.7 },
  headlineMd: { fontFamily: JAKARTA_700, fontSize: 24, lineHeight: 31, letterSpacing: -0.5 },
  headlineSm: { fontFamily: JAKARTA_700, fontSize: 20, lineHeight: 27, letterSpacing: -0.3 },
  titleMd: { fontFamily: JAKARTA_600, fontSize: 17, lineHeight: 23, letterSpacing: -0.2 },
  bodyLg: { fontFamily: INTER_400, fontSize: 18, lineHeight: 29, letterSpacing: -0.18 },
  bodyMd: { fontFamily: INTER_400, fontSize: 15, lineHeight: 23, letterSpacing: -0.08 },
  bodySm: { fontFamily: INTER_400, fontSize: 13, lineHeight: 20 },
  labelLg: { fontFamily: INTER_600, fontSize: 15, lineHeight: 20, letterSpacing: -0.08 },
  labelMd: { fontFamily: INTER_600, fontSize: 14, lineHeight: 18, letterSpacing: -0.07 },
  labelSm: { fontFamily: INTER_600, fontSize: 12, lineHeight: 15, letterSpacing: 0.3 },
  labelXs: { fontFamily: INTER_600, fontSize: 11, lineHeight: 14, letterSpacing: 0.2 },
} as const;

export const m3Fonts = { JAKARTA_600, JAKARTA_700, JAKARTA_800, INTER_400, INTER_500, INTER_600, INTER_700 } as const;

/** Soft elevation matching the mockups' `shadow-[0_2px_10px_rgba(19,27,46,0.04)]`. */
export const m3Shadow = {
  card: {
    shadowColor: '#131B2E',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#131B2E',
    shadowOpacity: 0.09,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
} as const;
