import { Ionicons as BaseIonicons, MaterialIcons as BaseMaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

// Icon-font glyphs are private-use characters: screen readers announce nothing
// useful, and on web the glyph leaks into the accessible name of the button
// around it. Icons are decorative here; the control around one carries the label.
const hidden = { 'aria-hidden': true, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const;

export function Ionicons(props: ComponentProps<typeof BaseIonicons>) {
  return <BaseIonicons {...hidden} {...props} />;
}
Ionicons.glyphMap = BaseIonicons.glyphMap;

export function MaterialIcons(props: ComponentProps<typeof BaseMaterialIcons>) {
  return <BaseMaterialIcons {...hidden} {...props} />;
}
MaterialIcons.glyphMap = BaseMaterialIcons.glyphMap;
