// Keep device-local wall-clock digits in the form; convert to UTC only on save.
export function localOccurrenceValue(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function occurrenceFromIso(value: string | Date): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : localOccurrenceValue(date);
}

export function parseLocalOccurrence(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Reject impossible dates and DST spring-forward gaps instead of silently normalizing.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute) return null;
  return date.toISOString();
}
