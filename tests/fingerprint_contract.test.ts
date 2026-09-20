import { expect, test } from "bun:test";
import {
  computePayloadFingerprint as backendFp,
  computeCanonicalPayload as backendCanon,
} from "../server/serveFingerprint";
import {
  computePayloadFingerprint as clientFp,
  computeCanonicalPayload as clientCanon,
} from "../src/lib/serveFingerprint";

test("Contract: client and backend fingerprint algorithms produce byte-for-byte identical SHA-256 hashes", () => {
  const vectors = [
    // 1. Empty payload
    {},

    // 2. Status / method / attempt casing and normalization
    { status: "COMPLETED", service_method: "Personal", attempt_type: "PHYSICAL" },
    { status: "completed", serviceMethod: "personal", attemptType: "physical" },
    { status: "FAILED", service_method: "SUBSTITUTE", notes: "no answer" },

    // 3. Case ID aliases and trimming
    { case_id: "  CASE_101  ", caseId: "ignored_alias" },
    { caseId: "CASE_102" },

    // 4. Recipient ID aliases
    { recipient_id: "  rec_001  ", recipientId: "ignored" },
    { recipientId: "rec_002" },

    // 5. Person aliases and whitespace
    { person_being_served: " Alice Smith ", personBeingServed: "Bob", person: "Charlie" },
    { personBeingServed: " Bob Jones " },
    { person: " Charlie Brown " },

    // 6. Timestamps (occurred_at / occurredAt / timestamp)
    { occurred_at: "2026-09-20T14:30:00.000Z" },
    { occurredAt: "2026-09-20T14:30:00.000Z" },
    { timestamp: "2026-09-20T14:30:00.000Z" },

    // 7. Notes and accepted_by trimming
    { notes: "  gate code: #4921, beware of dog  ", accepted_by: "  John Doe (Resident)  " },
    { acceptedBy: " Jane Doe " },

    // 8. Address aliases
    { address: "123 Main St, Tulsa, OK", service_address: "456 Elm St, Tulsa, OK" },
    { serviceAddress: "789 Oak Ave, Broken Arrow, OK" },

    // 9. Coordinate normalization: objects, strings, JSON, 6 decimals
    { coordinates: { lat: 36.153987123, lng: -95.992775987 } },
    { coordinates: { latitude: 36.153987123, longitude: -95.992775987 } },
    { coordinates: "36.153987, -95.992776" },
    { coordinates: "{\"lat\":36.153987,\"lng\":-95.992776}" },
    { coordinates: "not-a-coordinate" },

    // 10. Entity name and corporate agent aliases
    { entity_name: " Acme Corp ", corporate_agent: "Agent One" },
    { corporateAgent: " Agent Two " },
    { entityName: " Beta LLC " },

    // 11. Recipient title
    { recipient_title: " Registered Agent " },
    { recipientTitle: " General Manager " },

    // 12. Event ID aliases
    { event_id: " evt_stop_123 " },
    { eventId: " evt_stop_456 " },

    // 13. Posting location aliases
    { posting_location: " front door attached securely " },
    { postingLocation: " side gate posted " },

    // 14. Stable UUID is excluded from canonical payload and fingerprint
    { id: "random_client_generated_id_1" },
    { id: "random_client_generated_id_2" },

    // 15. Single photo: base64 data URI
    { imageData: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
    { image_data: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },

    // 16. Multiple photos: position sorting
    {
      photos: [
        { position: 2, imageData: "data:image/jpeg;base64,BAUGBwgJCgsMDQ4PEBESExQ=" },
        { position: 1, imageData: "data:image/jpeg;base64,AQIDBAUGBwgJCgsMDQ4PEBE=" },
      ],
    },

    // 17. Multiple photos: position tiebreaker by hash
    {
      photos: [
        { position: 1, imageData: "data:image/jpeg;base64,AQIDBAUGBwgJCgsMDQ4PEBE=" },
        { position: 1, imageData: "data:image/jpeg;base64,BAUGBwgJCgsMDQ4PEBESExQ=" },
      ],
    },

    // 18. URL-based photo hashes
    { imageUrl: "https://r2.servetracker.internal/photo1.jpg" },
    { image_url: "https://r2.servetracker.internal/photo2.jpg" },

    // 19. Pre-hashed file_hash photos
    {
      photos: [
        { position: 1, file_hash: "a3f5c9e2b1d4a6f8c0e2b4d6f8a0b2c4e6f8a0b2c4e6f8a0b2c4e6f8a0b2c4e6" },
        { position: 2, file_hash: "b4d6f8a0b2c4e6f8a0b2c4e6f8a0b2c4e6f8a0b2c4e6f8a0b2c4e6f8a0b2c4e6" },
      ],
    },

    // 20. Comprehensive full realistic serve
    {
      id: "client_uuid_should_not_matter",
      case_id: "case_999",
      case_number: "CJ-2026-1234",
      recipient_id: "rec_777",
      person_being_served: "Jane Doe",
      occurred_at: "2026-09-20T16:45:00Z",
      status: "completed",
      service_method: "personal",
      notes: "Hand delivered to Jane Doe in front yard.",
      service_address: "742 Evergreen Terr, Tulsa, OK 74101",
      coordinates: { lat: 36.12345678, lng: -95.98765432 },
      accepted_by: "Jane Doe (Self)",
      posting_location: "",
      entity_name: "",
      recipient_title: "Defendant",
      event_id: "evt_full_stop_99",
      photos: [
        { position: 2, imageData: "data:image/jpeg;base64,AQIDBAU=" },
        { position: 1, imageData: "data:image/jpeg;base64,BgYHBwk=" },
      ],
    },
  ];

  for (let i = 0; i < vectors.length; i++) {
    const vec = vectors[i];
    const bCanon = backendCanon(vec);
    const cCanon = clientCanon(vec);
    expect(cCanon).toEqual(bCanon);

    const bFp = backendFp(vec);
    const cFp = clientFp(vec);
    expect(cFp).toBe(bFp);
    expect(cFp.length).toBe(64);
  }
});

test("Contract: stable ID is strictly excluded from fingerprint", () => {
  const base = {
    case_id: "case_abc",
    person_being_served: "Target Person",
    status: "completed",
    notes: "Served at residence",
  };

  const fp1 = clientFp({ ...base, id: "client_id_AAA" });
  const fp2 = clientFp({ ...base, id: "client_id_BBB" });
  const backendHash = backendFp(base);

  expect(fp1).toBe(fp2);
  expect(fp1).toBe(backendHash);
});
