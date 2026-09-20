import { expect, test, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "path";
import { Client, expectStatus, DATA_DIR } from "./helpers";
import {
  computePayloadFingerprint,
  computeCanonicalPayload,
  extractOrderedPhotoHashes,
} from "../server/serveFingerprint";

let admin: Client;
let serverClient: Client;
let serverUser: { id: string; username: string };
let clientId = "";
let db: Database;

async function makeCase(person: string, assignedTo?: string): Promise<{ id: string; case_number: string; recipient_id: string }> {
  const caseNum = `SYNC-${Math.floor(Math.random() * 90000 + 10000)}`;
  const created = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: caseNum,
    case_name: person,
    defendant_respondent: person,
    home_address: "1000 Sync Way, Tulsa, OK 74103",
    documents_to_serve: "Subpoena",
    assigned_to: assignedTo || "",
  });
  expectStatus(created, 201, "create case");
  const caseId = created.data.id;

  // Add recipient
  const rec = await admin.post("/api/recipients", {
    case_id: caseId,
    client_id: clientId,
    full_name: person,
    home_address: "1000 Sync Way, Tulsa, OK 74103",
  });
  expectStatus(rec, 201, "create recipient");

  return { id: caseId, case_number: caseNum, recipient_id: rec.data.id };
}

beforeAll(async () => {
  db = new Database(join(DATA_DIR, "pdfusaedit.db"));

  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");

  const cl = await admin.post("/api/clients", {
    name: "Sync Durability Client",
    email: "sync@test.example",
    phone: "(918) 555-0188",
  });
  expectStatus(cl, 201, "create client");
  clientId = cl.data.id;

  // Create a field server user
  const serverUsername = `srv_${Date.now()}`;
  const srv = await admin.post("/api/users", {
    username: serverUsername,
    password: "Password123!",
    name: "Field Server Test",
    displayName: "Field Server Test",
    email: `${serverUsername}@example.test`,
    phone: "555-0100",
    role: "server",
    licenseNumber: "PSL-9999",
    licenseJurisdiction: "OK",
    licenseExpiresAt: "2030-12-31",
    serviceTerritory: ["Tulsa"],
  });
  expectStatus(srv, 201, "create server user");
  serverUser = { id: srv.data.user.id, username: serverUsername };

  // Complete onboarding and clear must_change_password
  await admin.put(`/api/users/${serverUser.id}`, {
    onboardingStatus: "complete",
    status: "active",
  });
  db.run("UPDATE users SET must_change_password = 0, is_active = 1 WHERE id = ?", [serverUser.id]);

  serverClient = new Client();
  const sLog = await serverClient.post("/api/auth/login", {
    username: serverUsername,
    password: "Password123!",
  });
  expectStatus(sLog, 200, "server login");
});

test("photo fingerprint ordering: photos in different input order yield deterministic fingerprint", () => {
  const photo1 = { position: 1, imageData: "data:image/jpeg;base64," + Buffer.from("PHOTO_1_BYTES").toString("base64") };
  const photo2 = { position: 2, imageData: "data:image/jpeg;base64," + Buffer.from("PHOTO_2_BYTES").toString("base64") };

  const payloadOrderA = {
    case_id: "c1",
    recipient_id: "r1",
    person: "Alice",
    status: "completed",
    notes: "served",
    photos: [photo1, photo2],
  };

  const payloadOrderB = {
    case_id: "c1",
    recipient_id: "r1",
    person: "Alice",
    status: "completed",
    notes: "served",
    photos: [photo2, photo1], // Reversed array order, but position is 1 and 2
  };

  const fpA = computePayloadFingerprint(payloadOrderA);
  const fpB = computePayloadFingerprint(payloadOrderB);
  expect(fpA).toBe(fpB);

  // Volatile fields (entered_at, server timestamps) do not change fingerprint
  const payloadWithVolatile = {
    ...payloadOrderA,
    entered_at: "2026-09-20T23:59:59Z",
    user_agent: "Mozilla/5.0 Custom Test Agent",
  };
  expect(computePayloadFingerprint(payloadWithVolatile)).toBe(fpA);

  // Changing photo content DOES change fingerprint
  const photoDiff = { position: 1, imageData: "data:image/jpeg;base64," + Buffer.from("DIFFERENT_BYTES").toString("base64") };
  const payloadDiffPhoto = {
    ...payloadOrderA,
    photos: [photoDiff, photo2],
  };
  expect(computePayloadFingerprint(payloadDiffPhoto)).not.toBe(fpA);
});

test("successful response returns verified sync metadata and persists to SQLite", async () => {
  const c = await makeCase("Target Person Alpha");
  const serveId = `serve_${Date.now()}_alpha`;
  const photoData = "data:image/jpeg;base64," + Buffer.from("TEST_PHOTO_CONTENT_ALPHA").toString("base64");

  const servePayload = {
    id: serveId,
    case_id: c.id,
    case_number: c.case_number,
    recipient_id: c.recipient_id,
    person_being_served: "Target Person Alpha",
    status: "completed",
    service_method: "personal",
    notes: "Hand delivered to target",
    service_address: "1000 Sync Way, Tulsa, OK 74103",
    coordinates: { lat: 36.153981, lng: -95.992775 },
    photos: [{ position: 1, imageData: photoData }],
  };

  const expectedFingerprint = computePayloadFingerprint(servePayload);

  const res = await admin.post("/api/serves", servePayload);
  expectStatus(res, 201, "initial serve post");

  // Verify response includes sync receipt metadata
  expect(res.data.committed).toBe(true);
  expect(res.data.persisted).toBe(true);
  expect(res.data.serveId).toBe(serveId);
  expect(res.data.payloadFingerprint).toBe(expectedFingerprint);
  expect(res.data.attemptNumber).toBe(1);
  expect(res.data.photoCount).toBe(1);
  expect(typeof res.data.committedAt).toBe("string");
  expect(res.data.committedAt.length).toBeGreaterThan(0);
  expect(res.data.syncVersion).toBe(1);

  // Verify row directly in SQLite
  const row = db.query("SELECT * FROM serve_attempts WHERE id = ?").get(serveId) as any;
  expect(row).toBeDefined();
  expect(row.payload_fingerprint).toBe(expectedFingerprint);
  expect(row.sync_version).toBe(1);
  expect(row.committed_at).toBe(res.data.committedAt);
});

test("idempotent replay: same ID + matching payload returns existing row without side effects", async () => {
  const c = await makeCase("Target Person Beta");
  const serveId = `serve_${Date.now()}_beta`;

  const servePayload = {
    id: serveId,
    case_id: c.id,
    case_number: c.case_number,
    recipient_id: c.recipient_id,
    person_being_served: "Target Person Beta",
    status: "failed",
    attempt_type: "physical",
    notes: "No answer at residence",
    service_address: "1000 Sync Way, Tulsa, OK 74103",
    coordinates: "36.153981, -95.992775",
  };

  const expectedFp = computePayloadFingerprint(servePayload);

  // First POST
  const res1 = await admin.post("/api/serves", servePayload);
  expectStatus(res1, 201, "first post");
  expect(res1.data.payloadFingerprint).toBe(expectedFp);

  const auditCountBefore = (db.query("SELECT COUNT(*) as cnt FROM audit_logs WHERE target_resource_id = ?").get(serveId) as any).cnt;

  // Second POST with EXACT same ID and payload
  const res2 = await admin.post("/api/serves", servePayload);
  expectStatus(res2, 200, "idempotent second post");
  expect(res2.data.committed).toBe(true);
  expect(res2.data.persisted).toBe(true);
  expect(res2.data.idempotent).toBe(true);
  expect(res2.data.serveId).toBe(serveId);
  expect(res2.data.payloadFingerprint).toBe(expectedFp);

  // DB must still have only 1 row
  const countRow = db.query("SELECT COUNT(*) as cnt FROM serve_attempts WHERE id = ?").get(serveId) as any;
  expect(countRow.cnt).toBe(1);

  // No duplicate audit log created
  const auditCountAfter = (db.query("SELECT COUNT(*) as cnt FROM audit_logs WHERE target_resource_id = ?").get(serveId) as any).cnt;
  expect(auditCountAfter).toBe(auditCountBefore);
});

test("conflict handling: same ID + different payload returns HTTP 409 id_conflict", async () => {
  const c = await makeCase("Target Person Gamma");
  const serveId = `serve_${Date.now()}_gamma`;

  const originalPayload = {
    id: serveId,
    case_id: c.id,
    case_number: c.case_number,
    recipient_id: c.recipient_id,
    person_being_served: "Target Person Gamma",
    status: "failed",
    notes: "Original attempt notes",
    service_address: "1000 Sync Way, Tulsa, OK 74103",
  };

  const res1 = await admin.post("/api/serves", originalPayload);
  expectStatus(res1, 201, "initial post");

  // Tampered/conflicting payload with changed notes
  const conflictPayload = {
    ...originalPayload,
    notes: "Tampered / completely different notes",
  };

  const res2 = await admin.post("/api/serves", conflictPayload);
  expectStatus(res2, 409, "conflict post");
  expect(res2.data.error).toBe("id_conflict");
  expect(res2.data.serveId).toBe(serveId);
  expect(res2.data.existingFingerprint).toBeDefined();
  expect(res2.data.incomingFingerprint).toBeDefined();
  expect(res2.data.existingFingerprint).not.toBe(res2.data.incomingFingerprint);

  // Stored row is completely untouched
  const row = db.query("SELECT notes FROM serve_attempts WHERE id = ?").get(serveId) as any;
  expect(row.notes).toBe("Original attempt notes");
});

test("confirm endpoint: match (200), missing (404), mismatch (409), and RBAC isolation", async () => {
  const c = await makeCase("Target Person Delta", serverUser.id);
  const serveId = `serve_${Date.now()}_delta`;

  const servePayload = {
    id: serveId,
    case_id: c.id,
    case_number: c.case_number,
    recipient_id: c.recipient_id,
    person_being_served: "Target Person Delta",
    status: "completed",
    service_method: "personal",
    notes: "Served Delta",
    service_address: "1000 Sync Way, Tulsa, OK 74103",
  };

  const postRes = await admin.post("/api/serves", servePayload);
  expectStatus(postRes, 201, "create delta serve");
  const fp = postRes.data.payloadFingerprint;

  // 1. Match with correct fingerprint -> 200
  const matchRes = await admin.get(`/api/serves/${serveId}/confirm?fingerprint=${fp}`);
  expectStatus(matchRes, 200, "confirm match");
  expect(matchRes.data.confirmed).toBe(true);
  expect(matchRes.data.serveId).toBe(serveId);
  expect(matchRes.data.payloadFingerprint).toBe(fp);
  expect(matchRes.data.photoCount).toBe(0);

  // 2. Nonexistent serve -> 404
  const missingRes = await admin.get(`/api/serves/serve_nonexistent_xyz/confirm?fingerprint=${fp}`);
  expectStatus(missingRes, 404, "confirm missing");

  // 3. Mismatched fingerprint -> 409
  const wrongFp = "deadbeef".repeat(8);
  const mismatchRes = await admin.get(`/api/serves/${serveId}/confirm?fingerprint=${wrongFp}`);
  expectStatus(mismatchRes, 409, "confirm mismatch");
  expect(mismatchRes.data.error).toBe("fingerprint_mismatch");

  // 4. RBAC: assigned server CAN confirm
  const serverAssignedRes = await serverClient.get(`/api/serves/${serveId}/confirm?fingerprint=${fp}`);
  expectStatus(serverAssignedRes, 200, "assigned server confirm");

  // 5. RBAC: unassigned server CANNOT confirm (403)
  const unassignedCase = await makeCase("Unassigned Person", "usr_admin_default");
  const unassignedServeId = `serve_${Date.now()}_unassigned`;
  const unassignedPost = await admin.post("/api/serves", {
    id: unassignedServeId,
    case_id: unassignedCase.id,
    case_number: unassignedCase.case_number,
    recipient_id: unassignedCase.recipient_id,
    person_being_served: "Unassigned Person",
    status: "failed",
    notes: "Admin attempt",
  });
  expectStatus(unassignedPost, 201, "unassigned post");
  const unassignedFp = unassignedPost.data.payloadFingerprint;

  const serverBlockedRes = await serverClient.get(`/api/serves/${unassignedServeId}/confirm?fingerprint=${unassignedFp}`);
  expectStatus(serverBlockedRes, 403, "unassigned server blocked");
});

test("forced local commit failure after R2 produces HTTP 503 with archived: true, committed: false", async () => {
  const c = await makeCase("Target Person Epsilon");
  const serveId = `serve_${Date.now()}_epsilon`;

  // Install a temporary SQLite trigger to force commit failure on serve_attempts
  db.run("CREATE TRIGGER fail_serve_attempts BEFORE INSERT ON serve_attempts BEGIN SELECT RAISE(ABORT, 'forced local sqlite failure'); END;");

  try {
    const res = await admin.post("/api/serves", {
      id: serveId,
      case_id: c.id,
      case_number: c.case_number,
      recipient_id: c.recipient_id,
      person_being_served: "Target Person Epsilon",
      status: "completed",
      service_method: "personal",
      notes: "Will fail on local commit",
      service_address: "1000 Sync Way, Tulsa, OK 74103",
    });

    // Expect 503 with durability contract
    expectStatus(res, 503, "post after forced failure");
    expect(res.data.archived).toBe(true);
    expect(res.data.committed).toBe(false);
    expect(res.data.retry).toBe(true);
    expect(res.data.serveId).toBe(serveId);

    // Verify row was NOT inserted into SQLite
    const row = db.query("SELECT * FROM serve_attempts WHERE id = ?").get(serveId);
    expect(row).toBeNull();
  } finally {
    db.run("DROP TRIGGER IF EXISTS fail_serve_attempts;");
  }
});

test("transaction rollback: error during photo rows rolls back attempt insertion atomically", async () => {
  const c = await makeCase("Target Person Zeta");
  const serveId = `serve_${Date.now()}_zeta`;
  const photoData = "data:image/jpeg;base64," + Buffer.from("PHOTO_ZETA").toString("base64");

  // Force failure on serve_attempt_photos table
  db.run("CREATE TRIGGER fail_photo_tx BEFORE INSERT ON serve_attempt_photos BEGIN SELECT RAISE(ABORT, 'forced photo insert error'); END;");

  try {
    const res = await admin.post("/api/serves", {
      id: serveId,
      case_id: c.id,
      case_number: c.case_number,
      recipient_id: c.recipient_id,
      person_being_served: "Target Person Zeta",
      status: "failed",
      notes: "Rollback test",
      photos: [{ position: 1, imageData: photoData }],
    });

    expectStatus(res, 503, "rollback 503 response");
    expect(res.data.archived).toBe(true);
    expect(res.data.committed).toBe(false);

    // Verify atomic rollback: attempt row must NOT exist in DB
    const attemptRow = db.query("SELECT * FROM serve_attempts WHERE id = ?").get(serveId);
    expect(attemptRow).toBeNull();

    const photoRows = db.query("SELECT * FROM serve_attempt_photos WHERE serve_id = ?").all(serveId);
    expect(photoRows.length).toBe(0);
  } finally {
    db.run("DROP TRIGGER IF EXISTS fail_photo_tx;");
  }
});

test("already_served is not persisted and returns committed: false, persisted: false", async () => {
  const c = await makeCase("Target Person Eta");

  // 1. First serve: successful
  const res1 = await admin.post("/api/serves", {
    case_id: c.id,
    case_number: c.case_number,
    recipient_id: c.recipient_id,
    person_being_served: "Target Person Eta",
    status: "completed",
    service_method: "personal",
    notes: "First successful serve",
    service_address: "1000 Sync Way, Tulsa, OK 74103",
  });
  expectStatus(res1, 201, "first serve success");
  const firstId = res1.data.id;

  const countBefore = (db.query("SELECT COUNT(*) as cnt FROM serve_attempts WHERE case_id = ? AND recipient_id = ?").get(c.id, c.recipient_id) as any).cnt;
  expect(countBefore).toBe(1);

  // 2. Second serve attempt for same case + recipient (e.g. stop for companion)
  const res2 = await admin.post("/api/serves", {
    case_id: c.id,
    case_number: c.case_number,
    recipient_id: c.recipient_id,
    person_being_served: "Target Person Eta",
    status: "failed",
    notes: "Attempted second stop",
    service_address: "1000 Sync Way, Tulsa, OK 74103",
  });

  expectStatus(res2, 201, "already_served response");
  expect(res2.data.skipped).toBe(true);
  expect(res2.data.reason).toBe("already_served");
  expect(res2.data.committed).toBe(false);
  expect(res2.data.persisted).toBe(false);
  expect(res2.data.id).toBe(firstId); // references original row

  // Database must NOT have a second attempt row
  const countAfter = (db.query("SELECT COUNT(*) as cnt FROM serve_attempts WHERE case_id = ? AND recipient_id = ?").get(c.id, c.recipient_id) as any).cnt;
  expect(countAfter).toBe(1);
});
