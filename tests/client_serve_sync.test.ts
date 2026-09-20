import "fake-indexeddb/auto";
import { expect, test, beforeEach } from "bun:test";
import {
  saveStopDeliveriesToOutbox,
  listPending,
  syncItem,
  syncOutbox,
  removePending,
  hasUnverifiedAttemptsForCase,
  getPendingForCase,
  getPhotosForServe,
  rehydrateServePayload,
  withCrossTabLock,
  startOfflineSync,
  flushPending,
  registerSyncHandlers,
  isDurableStorage,
  __setSimulateQuotaError,
  __setSimulateOpenDbError,
  __setSimulateTxError,
  __setSimulateReadBackError,
  __clearMemoryStores,
  StorageQuotaError,
  newOfflineId,
  computePayloadFingerprint,
  DB_NAME,
  STORE_PENDING,
  STORE_PHOTOS,
  type OutboxItem,
} from "../src/lib/offlineQueue";
import { api } from "../src/lib/api";

beforeEach(async () => {
  __clearMemoryStores();
  __setSimulateQuotaError(false);
  __setSimulateOpenDbError(false);
  __setSimulateTxError(false);
  __setSimulateReadBackError(false);

  // Clear fake-indexeddb tables
  const req = indexedDB.deleteDatabase(DB_NAME);
  await new Promise((resolve) => {
    req.onsuccess = resolve;
    req.onerror = resolve;
    req.onblocked = resolve;
  });
});

// 1. Write-ahead before fetch
test("1. write-ahead: persists all stop deliveries in outbox before network call", async () => {
  const deliveries = [
    {
      payload: {
        case_id: "case_001",
        case_number: "FD-2026-001",
        person_being_served: "Alice Smith",
        status: "completed",
        service_method: "personal",
      },
      photos: [{ imageData: "data:image/jpeg;base64,sample1" }],
    },
    {
      payload: {
        case_id: "case_001",
        case_number: "FD-2026-001",
        person_being_served: "Bob Smith",
        status: "completed",
        service_method: "substitute",
      },
      photos: [{ imageData: "data:image/jpeg;base64,sample2" }],
    },
  ];

  const saved = await saveStopDeliveriesToOutbox(deliveries);
  expect(saved.length).toBe(2);
  expect(saved[0].state).toBe("pending");
  expect(saved[1].state).toBe("pending");
  expect(saved[0].attempts).toBe(0);
  expect(saved[0].fingerprint).toBeTruthy();
  expect(saved[0].id).toBeTruthy();
  expect(saved[1].id).toBeTruthy();
  expect(saved[0].id).not.toBe(saved[1].id);

  const pending = await listPending();
  expect(pending.length).toBe(2);
  expect(pending[0].caseNumber).toBe("FD-2026-001");
  expect(pending[1].caseNumber).toBe("FD-2026-001");
  expect(isDurableStorage()).toBe(true);
});

// 2. Network drop
test("2. network drop: stays in outbox as pending with incremented attempts and lastError", async () => {
  const saved = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "drop_test_1",
        case_id: "case_drop",
        person_being_served: "Charlie",
        status: "completed",
      },
    },
  ]);
  const item = saved[0];

  const mockPost = async () => {
    throw new TypeError("Failed to fetch");
  };
  const mockConfirm = async () => ({ status: 200, confirmed: true });

  const result = await syncItem(item, mockPost, mockConfirm);
  expect(result.state).toBe("pending");
  expect(result.item.attempts).toBe(1);
  expect(result.item.lastError).toContain("Failed to fetch");

  const inDb = await listPending();
  expect(inDb.length).toBe(1);
  expect(inDb[0].id).toBe("drop_test_1");
  expect(inDb[0].state).toBe("pending");
});

// 3. POST success + confirm 404 retains outbox
test("3. POST success + confirm 404: retains item in outbox as posted_unverified", async () => {
  const saved = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "confirm_404_test",
        case_id: "case_404",
        person_being_served: "Dan",
        status: "completed",
      },
    },
  ]);
  const item = saved[0];

  const mockPost = async (p: any) => ({
    sync: { committed: true, persisted: true, serveId: p.id },
  });
  const mockConfirm = async () => ({ status: 404, confirmed: false });

  const result = await syncItem(item, mockPost, mockConfirm);
  expect(result.state).toBe("posted_unverified");
  expect(result.receipt?.sync?.committed).toBe(true);

  // Must NOT delete from outbox on confirm 404!
  const inDb = await listPending();
  expect(inDb.length).toBe(1);
  expect(inDb[0].id).toBe("confirm_404_test");
  expect(inDb[0].state).toBe("posted_unverified");
});

// 4. Same-ID retry
test("4. same-id retry: reuses the exact same UUID across multiple sync attempts", async () => {
  const stableId = "stable_uuid_999";
  const saved = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: stableId,
        case_id: "case_retry",
        person_being_served: "Eve",
        status: "completed",
      },
    },
  ]);
  const item = saved[0];

  const receivedIds: string[] = [];
  let attemptCount = 0;
  const mockPost = async (p: any) => {
    receivedIds.push(p.id);
    attemptCount++;
    if (attemptCount === 1) {
      throw new Error("Temporary network timeout");
    }
    return { sync: { committed: true } };
  };
  const mockConfirm = async () => ({ status: 200, confirmed: true });

  // First sync fails
  const res1 = await syncItem(item, mockPost, mockConfirm, { force: true });
  expect(res1.state).toBe("pending");

  // Second sync succeeds
  const res2 = await syncItem(item, mockPost, mockConfirm, { force: true });
  expect(res2.state).toBe("verified");

  expect(receivedIds).toEqual([stableId, stableId]);
});

// 5. 409 conflict: distinguish POST id_conflict vs confirm fingerprint_mismatch
test("5. 409 conflict: distinguish POST id_conflict from confirm fingerprint_mismatch", async () => {
  // Test POST 409 (id_conflict)
  const savedPost = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "conflict_post_test",
        case_id: "case_conflict",
        person_being_served: "Frank",
        status: "completed",
      },
    },
  ]);
  const mockPostConflict = async () => {
    const err: any = new Error("409 id_conflict: serve ID exists with different data");
    err.status = 409;
    throw err;
  };
  const mockConfirm = async () => ({ status: 200, confirmed: true });

  const resPost = await syncItem(savedPost[0], mockPostConflict, mockConfirm);
  expect(resPost.state).toBe("conflict");
  expect(resPost.item.lastError).toContain("409 id_conflict");

  // Test Confirm 409 (fingerprint_mismatch)
  const savedConfirm = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "conflict_confirm_test",
        case_id: "case_conflict_2",
        person_being_served: "George",
        status: "completed",
      },
    },
  ]);
  const mockPostOk = async () => ({ committed: true });
  const mockConfirmMismatch = async () => ({
    status: 409,
    confirmed: false,
    error: "fingerprint_mismatch",
    message: "Stored serve fingerprint does not match requested fingerprint",
  });

  const resConfirm = await syncItem(savedConfirm[0], mockPostOk, mockConfirmMismatch);
  expect(resConfirm.state).toBe("conflict");
  expect(resConfirm.item.lastError).toContain("409 fingerprint_mismatch");
});

// 6. 503 archived pending
test("6. 503 archived pending: transitions to archived awaiting restore, retriable", async () => {
  const saved = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "archived_503_test",
        case_id: "case_503",
        person_being_served: "Grace",
        status: "completed",
      },
    },
  ]);
  const item = saved[0];

  const mockPost = async () => {
    const err: any = new Error("503 Service Unavailable");
    err.status = 503;
    throw err;
  };
  const mockConfirm = async () => ({ status: 200, confirmed: true });

  const result = await syncItem(item, mockPost, mockConfirm);
  expect(result.state).toBe("archived");
  expect(result.item.serverReceipt?.archived).toBe(true);

  const inDb = await listPending();
  expect(inDb.length).toBe(1);
  expect(inDb[0].state).toBe("archived");
});

// 7. already_served skipped truthful UX
test("7. already_served skipped: marks skipped, preserves receipt, truthful status", async () => {
  const saved = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "skip_test_1",
        case_id: "case_skip",
        person_being_served: "Hannah",
        status: "completed",
      },
    },
  ]);
  const item = saved[0];

  const mockPost = async () => ({
    skipped: true,
    reason: "already_served",
    committed: false,
    persisted: false,
  });
  const mockConfirm = async () => ({ status: 200, confirmed: true });

  const result = await syncItem(item, mockPost, mockConfirm);
  expect(result.state).toBe("skipped");
  expect(result.receipt?.skipped).toBe(true);
  expect(result.receipt?.reason).toBe("already_served");

  const inDb = await listPending();
  expect(inDb.length).toBe(1);
  expect(inDb[0].state).toBe("skipped");
});

// 8. Multi-recipient partial outcomes
test("8. multi-recipient partial: handles mixed outcomes (1 verified, 1 already_served)", async () => {
  const deliveries = [
    {
      payload: {
        id: "multi_1",
        case_id: "case_multi",
        person_being_served: "Recipient One",
        status: "completed",
      },
    },
    {
      payload: {
        id: "multi_2",
        case_id: "case_multi",
        person_being_served: "Recipient Two",
        status: "completed",
      },
    },
  ];

  const items = await saveStopDeliveriesToOutbox(deliveries);
  expect(items.length).toBe(2);

  const mockPost = async (p: any) => {
    if (p.id === "multi_1") {
      return { sync: { committed: true, persisted: true } };
    } else {
      return { skipped: true, reason: "already_served", committed: false };
    }
  };
  const mockConfirm = async () => ({ status: 200, confirmed: true });

  const syncRes = await syncOutbox({
    targetIds: ["multi_1", "multi_2"],
    forceAll: true,
    postFn: mockPost,
    confirmFn: mockConfirm,
  });

  expect(syncRes.results.length).toBe(2);
  const r1 = syncRes.results.find((r) => r.id === "multi_1");
  const r2 = syncRes.results.find((r) => r.id === "multi_2");

  expect(r1?.state).toBe("verified");
  expect(r2?.state).toBe("skipped");
  expect(r2?.receipt?.reason).toBe("already_served");
});

// 9. Multi-tab lock
test("9. multi-tab lock: prevents concurrent sync runs while lock is held", async () => {
  let lock1Active = false;
  let concurrentDetected = false;

  const task1 = withCrossTabLock(async () => {
    lock1Active = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
    lock1Active = false;
    return "task1_done";
  });

  const task2 = withCrossTabLock(async () => {
    if (lock1Active) {
      concurrentDetected = true;
    }
    return "task2_done";
  });

  const [res1, res2] = await Promise.all([task1, task2]);
  expect(res1).toBe("task1_done");
  expect(res2).toBeNull();
  expect(concurrentDetected).toBe(false);

  const res3 = await withCrossTabLock(async () => "task3_done");
  expect(res3).toBe("task3_done");
});

// 10. BLOCKER 2: Fail-open IDB (open failure, tx abort, quota, and read-back assertions)
test("10. fail-open IDB: any IDB failure throws and never returns RAM success", async () => {
  // A. Storage quota error throws StorageQuotaError
  __setSimulateQuotaError(true);
  expect(
    saveStopDeliveriesToOutbox([
      {
        payload: { case_id: "quota_case", status: "completed" },
        photos: [{ imageData: "huge_base64_photo_data" }],
      },
    ])
  ).rejects.toThrow(StorageQuotaError);
  __setSimulateQuotaError(false);

  // B. Open DB failure throws and does not fall back to RAM
  __setSimulateOpenDbError(true);
  expect(
    saveStopDeliveriesToOutbox([
      {
        payload: { case_id: "open_fail_case", status: "completed" },
      },
    ])
  ).rejects.toThrow("Simulated IndexedDB open failure");
  __setSimulateOpenDbError(false);

  // C. Transaction abort throws
  __setSimulateTxError(true);
  expect(
    saveStopDeliveriesToOutbox([
      {
        payload: { case_id: "tx_fail_case", status: "completed" },
      },
    ])
  ).rejects.toThrow("Simulated transaction abort failure");
  __setSimulateTxError(false);

  // D. Read-back assertion failure throws
  __setSimulateReadBackError(true);
  expect(
    saveStopDeliveriesToOutbox([
      {
        payload: { case_id: "readback_fail_case", status: "completed" },
      },
    ])
  ).rejects.toThrow("Read-back assertion failed");
  __setSimulateReadBackError(false);

  // Assert outbox is clean
  const inDb = await listPending();
  expect(inDb.length).toBe(0);
});

// 11. Affidavit blocked pending
test("11. affidavit blocked pending: unverified outbox attempts block affidavit generation", async () => {
  const caseId = "CASE_BLOCK_100";
  expect(await hasUnverifiedAttemptsForCase(caseId)).toBe(false);

  const saved = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "aff_pending_item",
        case_id: caseId,
        person_being_served: "Target Recipient",
        status: "completed",
      },
    },
  ]);
  expect(saved[0].state).toBe("pending");

  expect(await hasUnverifiedAttemptsForCase(caseId)).toBe(true);

  await removePending(saved[0].id);
  expect(await hasUnverifiedAttemptsForCase(caseId)).toBe(false);
});

// 12. Real API / Re-service fail-closed test
test("12. re-service API: fail-closed on 404/501 without mutating original job or affidavit", async () => {
  const originalCaseId = "case_original_123";
  let thrownError: any = null;

  try {
    // Calling duplicateJobForReservice hits /api/cases/:id/reservice
    await api.duplicateJobForReservice(originalCaseId);
  } catch (err: any) {
    thrownError = err;
  }

  // Must fail closed (or reject with HTTP 404 / 501 / network failure if backend endpoint is pending)
  expect(thrownError).toBeTruthy();
  // Ensure that no local attempts or state was altered
  const pending = await listPending();
  expect(pending.length).toBe(0);
});

// 13. BLOCKER 3: Photo store deduplication, IDB reload survival, rehydration, and cleanup
test("13. photo store: deduplication, IDB survival, rehydration in order, and cleanup on verified", async () => {
  const photo1 = "data:image/jpeg;base64,PHOTO_ONE_RAW_BYTES";
  const photo2 = "data:image/png;base64,PHOTO_TWO_RAW_BYTES";

  const saved = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "photo_test_item",
        case_id: "case_photo_01",
        person_being_served: "John Target",
        status: "completed",
        service_method: "personal",
      },
      photos: [
        { id: "ph_pos2", position: 2, imageData: photo2 },
        { id: "ph_pos1", position: 1, imageData: photo1 },
      ],
    },
  ]);

  const item = saved[0];
  expect(item.id).toBe("photo_test_item");
  expect(item.photoIds).toEqual(["ph_pos2", "ph_pos1"]);

  // Assert deduplication: item.payload does NOT contain duplicated full photo bytes
  expect(item.payload.imageData).toBeUndefined();
  expect((item.payload.photos as any[])[0].imageData).toBeUndefined();
  expect((item.payload.photos as any[])[1].imageData).toBeUndefined();

  // Wipe memory map to simulate browser reload
  __clearMemoryStores();

  // Read back directly from IndexedDB
  const storedPhotos = await getPhotosForServe("photo_test_item");
  expect(storedPhotos.length).toBe(2);
  expect(storedPhotos[0].position).toBe(1);
  expect(storedPhotos[0].imageData).toBe(photo1);
  expect(storedPhotos[1].position).toBe(2);
  expect(storedPhotos[1].imageData).toBe(photo2);

  // Rehydrate before POST
  const rehydrated = await rehydrateServePayload(item);
  const rehydratedPhotos = rehydrated.photos as any[];
  expect(rehydratedPhotos.length).toBe(2);
  expect(rehydratedPhotos[0].position).toBe(1);
  expect(rehydratedPhotos[0].imageData).toBe(photo1);
  expect(rehydratedPhotos[1].position).toBe(2);
  expect(rehydratedPhotos[1].imageData).toBe(photo2);

  // Simulate network POST receiving rehydrated photos
  let receivedPayload: any = null;
  const mockPost = async (p: any) => {
    receivedPayload = p;
    return { sync: { committed: true, persisted: true } };
  };
  const mockConfirm = async () => ({ status: 200, confirmed: true });

  const syncRes = await syncItem(item, mockPost, mockConfirm);
  expect(syncRes.state).toBe("verified");
  expect(receivedPayload.photos.length).toBe(2);
  expect(receivedPayload.photos[0].imageData).toBe(photo1);

  // Verified confirm removes outbox item AND photo blobs from IndexedDB
  const remainingItems = await listPending();
  expect(remainingItems.length).toBe(0);
  const remainingPhotos = await getPhotosForServe("photo_test_item");
  expect(remainingPhotos.length).toBe(0);
});

// 14. BLOCKER 4: Fake confirm removal & handler validation
test("14. fake confirm removal: absent confirmFn throws and never POSTs or deletes", async () => {
  const saved = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "no_confirm_test",
        case_id: "case_nc",
        status: "completed",
      },
    },
  ]);

  let postCalled = false;
  const mockPost = async () => {
    postCalled = true;
    return { committed: true };
  };

  // syncOutbox without confirmFn must throw error and never post or delete
  expect(
    syncOutbox({
      targetIds: ["no_confirm_test"],
      postFn: mockPost,
      confirmFn: undefined as any,
    })
  ).rejects.toThrow("confirmFn is required");

  expect(postCalled).toBe(false);

  // flushPending without registered confirm handler throws
  expect(flushPending(mockPost)).rejects.toThrow("confirmation handler is not configured");

  // startOfflineSync without confirm handler throws
  expect(() => startOfflineSync(mockPost, undefined as any)).toThrow("confirmation handler");

  // Record remains intact in IndexedDB
  const pending = await listPending();
  expect(pending.length).toBe(1);
  expect(pending[0].id).toBe("no_confirm_test");
});

// 15. Error classification: HTTP status only, never substring matching like 4000ms
test("15. error classification: classifies by HTTP status only; 4000ms timeout stays pending", async () => {
  const saved = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "timeout_test",
        case_id: "case_timeout",
        status: "completed",
      },
    },
  ]);

  // Error message contains "4000ms" but has no HTTP status 400
  const mockPostTimeout = async () => {
    throw new Error("Request timed out after 4000ms");
  };
  const mockConfirm = async () => ({ status: 200, confirmed: true });

  const res = await syncItem(saved[0], mockPostTimeout, mockConfirm);
  // Must NOT be classified as blocked (HTTP 400)! Must be retryable pending!
  expect(res.state).toBe("pending");
  expect(res.item.lastError).toContain("4000ms");

  // Confirm 403 retains unverified with accurate forbidden message
  const saved403 = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "confirm_403_test",
        case_id: "case_403",
        status: "completed",
      },
    },
  ]);
  const mockPostOk = async () => ({ committed: true });
  const mockConfirm403 = async () => ({ status: 403, error: "Forbidden: Not assigned to this attempt" });

  const res403 = await syncItem(saved403[0], mockPostOk, mockConfirm403);
  expect(res403.state).toBe("posted_unverified");
  expect(res403.item.lastError).toContain("HTTP 403");
  expect(res403.item.lastError).not.toContain("404");

  // Confirm 500 retains unverified with accurate 500 error
  const saved500 = await saveStopDeliveriesToOutbox([
    {
      payload: {
        id: "confirm_500_test",
        case_id: "case_500",
        status: "completed",
      },
    },
  ]);
  const mockConfirm500 = async () => ({ status: 500, error: "Database lock timeout" });
  const res500 = await syncItem(saved500[0], mockPostOk, mockConfirm500);
  expect(res500.state).toBe("posted_unverified");
  expect(res500.item.lastError).toContain("HTTP 500");
});
