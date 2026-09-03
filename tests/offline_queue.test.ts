import { expect, test } from "bun:test";
import { isNetworkFailure, newOfflineId } from "../src/lib/offlineQueue";

test("network failures are queued, 400s are not", () => {
  expect(isNetworkFailure(new Error("Failed to fetch"))).toBe(true);
  expect(isNetworkFailure(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
  expect(isNetworkFailure(new Error("Request failed: 400"))).toBe(false);
  expect(isNetworkFailure(new Error("Forbidden: you can only log attempts on cases assigned to you"))).toBe(false);
});

test("offline ids are unique enough for retries", () => {
  const a = newOfflineId();
  const b = newOfflineId();
  expect(a).not.toBe(b);
  expect(a.length).toBeGreaterThan(8);
});
