import { expect, test, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";

let admin: Client;
let clientId = "";

async function makeCase(documents: string, person: string): Promise<{ id: string; case_number: string }> {
  const created = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: `CJ-${Math.floor(Math.random() * 90000 + 10000)}`,
    case_name: person,
    defendant_respondent: person,
    home_address: "2400 N 9th Street, Broken Arrow, OK 74012",
    documents_to_serve: documents,
  });
  expectStatus(created, 201, "create case");
  return { id: created.data.id, case_number: created.data.case_number };
}

beforeAll(async () => {
  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");

  const cl = await admin.post("/api/clients", {
    name: "Corporate Client",
    email: "client@corporate.example",
    phone: "(918) 555-0199",
  });
  expectStatus(cl, 201, "create client");
  clientId = cl.data.id;
});

test("corporate / registered agent serve: POST, GET, PUT round-trip with entity_name and recipient_title", async () => {
  const c = await makeCase("Summons", "Midfirst Bank Target");
  
  // 1. POST corporate serve
  const postRes = await admin.post("/api/serves", {
    case_id: c.id,
    case_number: c.case_number,
    person_being_served: "Midfirst Bank Target",
    status: "completed",
    service_method: "corporate",
    accepted_by: "Cynde Carner",
    entity_name: "Midfirst Bank",
    recipient_title: "Managing Agent",
    service_address: "2400 N 9th Street, Broken Arrow, OK 74012",
    notes: "Served managing agent at branch location.",
    sendEmail: false,
    isTest: true,
  });
  expectStatus(postRes, 201, "POST corporate serve");
  const serveId = postRes.data.id;
  expect(serveId).toBeDefined();

  // 2. GET serve attempts and verify fields are serialized
  const getRes = await admin.get(`/api/serves?caseId=${c.id}`);
  expectStatus(getRes, 200, "GET serves");
  const serves = getRes.data;
  const created = serves.find((s: any) => s.id === serveId);
  expect(created).toBeDefined();
  expect(created.serviceMethod).toBe("corporate");
  expect(created.acceptedBy).toBe("Cynde Carner");
  expect(created.entityName).toBe("Midfirst Bank");
  expect(created.recipientTitle).toBe("Managing Agent");

  // 3. PUT edit corporate serve
  const putRes = await admin.put(`/api/serves/${serveId}`, {
    notes: "Updated corporate notes",
    recipient_title: "President / Officer",
    entity_name: "Midfirst Bank Inc.",
  });
  expectStatus(putRes, 200, "PUT update corporate serve");

  // 4. Verify updated fields
  const getUpdated = await admin.get(`/api/serves?caseId=${c.id}`);
  const updated = getUpdated.data.find((s: any) => s.id === serveId);
  expect(updated.recipientTitle).toBe("President / Officer");
  expect(updated.entityName).toBe("Midfirst Bank Inc.");
  expect(updated.notes).toBe("Updated corporate notes");
});
