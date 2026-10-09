import { expect, test } from 'bun:test';
import { localOccurrenceValue, occurrenceFromIso, parseLocalOccurrence } from '../src/utils/serveOccurrence';
import { serveEditPayload } from '../src/utils/serveEditPayload';
import type { ServeAttemptData } from '../src/types/ServeAttemptData';

test('a local timestamp round-trips to UTC without using the logged-at time', () => {
  const local = localOccurrenceValue(new Date('2026-10-07T14:30:00.000Z'));
  expect(parseLocalOccurrence(local)).toBe('2026-10-07T14:30:00.000Z');
  expect(occurrenceFromIso('2026-10-07T14:30:00.000Z')).toBe(local);
});

test('invalid dates, malformed times, and spring DST gaps are rejected', () => {
  expect(parseLocalOccurrence('2026-02-30T10:00')).toBeNull();
  expect(parseLocalOccurrence('2026-01-02T24:00')).toBeNull();
  expect(parseLocalOccurrence('2026-01-02T10:99')).toBeNull();
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Chicago') {
    expect(parseLocalOccurrence('2026-03-08T02:30')).toBeNull();
  }
});

test('edited occurredAt is explicit while original timestamp and GPS never enter PUT', () => {
  const serve = { status: 'failed', notes: 'backfill', occurredAt: '2026-10-07T14:30:00.000Z', timestamp: '2026-10-07T15:00:00.000Z', coordinates: '36,-95', gpsSource: 'captured' } as ServeAttemptData;
  const payload = serveEditPayload(serve);
  expect(payload.occurredAt).toBe('2026-10-07T14:30:00.000Z');
  expect(payload).not.toHaveProperty('timestamp');
  expect(payload).not.toHaveProperty('coordinates');
  expect(payload).not.toHaveProperty('gpsSource');
});

test('no-op editor save omits occurredAt when dialog removes it', () => {
  const serve = { status: 'failed', notes: 'unchanged' } as ServeAttemptData;
  const payload = serveEditPayload(serve);
  expect(payload).not.toHaveProperty('occurredAt');
});
