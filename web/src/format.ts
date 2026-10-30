const clockFormat = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFormat = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const dateFormat = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Formats a timestamp as HH:mm in Oslo time. */
export function formatClock(iso: string): string {
  return clockFormat.format(new Date(iso));
}

/** Formats a timestamp as DD.MM.YYYY in Oslo time. */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/** Formats a timestamp as DD.MM.YYYY HH:mm:ss in Oslo time. */
export function formatTimestamp(iso: string): string {
  return `${formatDate(iso)} ${timeFormat.format(new Date(iso))}`;
}

/** Formats a timestamp as HH:mm if it's today, otherwise DD.MM. */
export function formatShort(iso: string): string {
  const date: string = formatDate(iso);
  if (date === formatDate(new Date().toISOString())) return formatClock(iso);
  return date.slice(0, 5);
}
