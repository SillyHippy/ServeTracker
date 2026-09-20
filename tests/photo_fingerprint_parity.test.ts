import { expect, test } from "bun:test";
import { computePayloadFingerprint as clientFp } from "../src/lib/serveFingerprint";
import { computePayloadFingerprint as serverFp } from "../server/serveFingerprint";

/**
 * Regression guard: the client and server fingerprint functions live in separate
 * files and MUST stay byte-identical. When they drift, a field server's retry is
 * rejected with 409 id_conflict and the serve sits stuck as "conflict" in the
 * phone's outbox.
 *
 * This was a real bug: the server persists only photo positions 1..5, but the
 * client hashed every photo it was given. Any stop with 6+ photos therefore
 * fingerprinted differently on each side.
 */

const base = {
  case_id: "case_abc",
  person_being_served: "Test Person",
  status: "completed",
  service_method: "personal",
  entered_at: "2026-09-20T18:00:00.000Z",
  gps_lat: 36.0584472,
  gps_lng: -95.8354863,
  notes: "front door",
};

function photo(position: number) {
  return { position, imageUrl: `/uploads/serves/p${position}.jpg` };
}

test("6 photos: client and server fingerprints agree (extras are dropped on write)", () => {
  const payload = { ...base, photos: [1, 2, 3, 4, 5, 6].map(photo) };
  expect(clientFp(payload)).toBe(serverFp(payload));
});

test("10 photos: still agree", () => {
  const payload = { ...base, photos: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(photo) };
  expect(clientFp(payload)).toBe(serverFp(payload));
});

test("changing an out-of-range photo does not change the fingerprint", () => {
  const five = { ...base, photos: [1, 2, 3, 4, 5].map(photo) };
  const sixA = { ...base, photos: [1, 2, 3, 4, 5, 6].map(photo) };
  const sixB = { ...base, photos: [...[1, 2, 3, 4, 5].map(photo), photo(9)] };
  expect(clientFp(sixA)).toBe(clientFp(sixB));
  expect(serverFp(sixA)).toBe(serverFp(sixB));
  // A 5-photo stop and a 6-photo stop must ALSO match, since the 6th is discarded.
  expect(clientFp(five)).toBe(clientFp(sixA));
});

test("changing an in-range photo DOES change the fingerprint on both sides", () => {
  const a = { ...base, photos: [1, 2, 3, 4, 5].map(photo) };
  const b = { ...base, photos: [{ position: 1, imageUrl: "/uploads/serves/different.jpg" }, ...[2, 3, 4, 5].map(photo)] };
  expect(clientFp(a)).not.toBe(clientFp(b));
  expect(serverFp(a)).not.toBe(serverFp(b));
});
