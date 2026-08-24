export const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/(^|\s)\S/g, letter => letter.toUpperCase());
export const formatMoney = (value: string | number | null | undefined, currency = 'USD') => {
  const amount = Number(value ?? 0);
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0); }
  catch { return `${currency} ${(Number.isFinite(amount) ? amount : 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
};
export const formatDate = (value: string | null | undefined, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => value ? new Intl.DateTimeFormat(undefined, options).format(new Date(value)) : 'Not set';
export const formatDateTime = (value: string | null | undefined) => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Not set';
export const formatDuration = (seconds: number | null | undefined) => { if (seconds == null) return 'Not contacted'; if (seconds < 60) return `${seconds} seconds`; const minutes = Math.floor(seconds / 60); return `${minutes} minute${minutes === 1 ? '' : 's'}`; };
