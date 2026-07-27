/** Money always arrives in integer minor units; format in the sale currency. */
export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    currency,
    style: "currency",
  }).format(minor / 100);
}

/**
 * Event times render in the event's own time zone, never the viewer's. Uses
 * explicit component options because `timeZoneName` cannot combine with the
 * `dateStyle`/`timeStyle` presets.
 */
export function formatEventInstant(iso: string, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone,
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(iso));
  return formatted;
}
