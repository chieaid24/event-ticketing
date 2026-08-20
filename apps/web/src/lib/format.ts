// money arrives in integer minor units; format in sale currency
export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    currency,
    style: "currency",
  }).format(minor / 100);
}

// explicit options allow event zone names
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
