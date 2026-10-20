import type { ChatPalette } from '../components/chat/ChatKit';
import { premium } from './premiumTheme';

/** Customer chat look: deep-green "mine" bubbles on warm cream, like the welcome screen. */
export const customerChatPalette: ChatPalette = {
  bg: '#EFECE4',
  mineBubble: premium.deep, mineText: premium.onDeep, mineMeta: premium.onDeepSoft,
  theirBubble: premium.card, theirText: premium.ink, theirMeta: premium.inkFaint, theirBorder: premium.line,
  composerBg: premium.card, inputBg: premium.bg, inputBorder: premium.line, inputText: premium.ink, placeholder: premium.inkFaint,
  sendBg: premium.deep, sendIcon: premium.onDeep,
  chipBg: 'rgba(255,253,249,0.92)', chipText: premium.inkSoft,
  line: premium.line,
  font: { body: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold' },
};
