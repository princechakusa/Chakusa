import type { ReactNode } from 'react';

// Pure helpers for the inverted WhatsApp-style message list.

export interface ChatMessage {
  id: string;
  text: string;
  mine: boolean;
  at: string;
  failed?: boolean;
  /** Rendered under the bubble (e.g. assistant feedback buttons). */
  footer?: ReactNode;
}

export type ChatRow = { kind: 'day'; id: string; label: string } | { kind: 'msg'; id: string; message: ChatMessage; first: boolean };

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  const withinWeek = today.getTime() - d.getTime() < 6 * 86_400_000;
  return d.toLocaleDateString(undefined, withinWeek ? { weekday: 'long' } : { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function chatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Oldest-first messages → rows for an inverted list (newest first, day chip above each day). */
export function chatRows(messages: ChatMessage[]): ChatRow[] {
  const rows: ChatRow[] = [];
  let lastDay = '';
  let lastMine: boolean | null = null;
  for (const message of messages) {
    const day = new Date(message.at).toDateString();
    if (day !== lastDay) { rows.push({ kind: 'day', id: `day-${day}`, label: dayLabel(message.at) }); lastDay = day; lastMine = null; }
    rows.push({ kind: 'msg', id: message.id, message, first: lastMine !== message.mine });
    lastMine = message.mine;
  }
  return rows.reverse();
}

