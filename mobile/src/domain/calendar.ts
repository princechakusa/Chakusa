const pad = (value: number) => String(value).padStart(2, '0');
export const localDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
export function startOfDay(date: Date) { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
export function endOfDay(date: Date) { const value = startOfDay(date); value.setDate(value.getDate() + 1); return value; }
export function weekDates(anchor: Date) { const start = startOfDay(anchor); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; }); }
export function combineLocalDateTime(date: string, time: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null; const value = new Date(`${date}T${time}:00`); return Number.isNaN(value.getTime()) ? null : value.toISOString(); }

/** Minutes elapsed since local midnight, clamped to [0, 1440]. */
export function minutesOfDay(date: Date) {
  return Math.max(0, Math.min(1440, date.getHours() * 60 + date.getMinutes()));
}

export interface DayGridBlock<T> { item: T; startMinute: number; endMinute: number; lane: number; lanes: number; }

/**
 * Assigns overlapping events to side-by-side lanes for a day time-grid.
 * Events are grouped into clusters that transitively overlap; every event in a
 * cluster reports the same `lanes` count so the caller can size columns evenly.
 */
export function layoutDayGrid<T>(
  events: readonly T[],
  getStart: (item: T) => Date,
  getEnd: (item: T) => Date,
  minBlockMinutes = 20,
): DayGridBlock<T>[] {
  const sorted = events
    .map(item => {
      const startMinute = minutesOfDay(getStart(item));
      const rawEnd = minutesOfDay(getEnd(item));
      return { item, startMinute, endMinute: Math.max(rawEnd, startMinute + minBlockMinutes) };
    })
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

  const result: DayGridBlock<T>[] = [];
  let cluster: DayGridBlock<T>[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const lanes = cluster.reduce((max, block) => Math.max(max, block.lane + 1), 1);
    for (const block of cluster) { block.lanes = lanes; result.push(block); }
    cluster = [];
    clusterEnd = -1;
  };

  for (const entry of sorted) {
    if (cluster.length && entry.startMinute >= clusterEnd) flush();
    const taken = new Set(cluster.filter(b => b.endMinute > entry.startMinute).map(b => b.lane));
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    cluster.push({ item: entry.item, startMinute: entry.startMinute, endMinute: entry.endMinute, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, entry.endMinute);
  }
  if (cluster.length) flush();
  return result;
}
