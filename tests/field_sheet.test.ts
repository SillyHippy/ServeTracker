import { expect, test } from "bun:test";
import { generateFieldSheetHtml } from "../src/utils/fieldSheetEngine";

const sample = {
  caseNumber: "PG-26-22",
  caseName: "Lonnie Eugene Boyles Jr",
  courtName: "District Court in and for Tulsa County, Oklahoma",
  plaintiff: "Petitioner",
  defendant: "Lonnie Eugene Boyles Jr",
  documents: "Summons; Petition",
  notes: "Evenings only",
  requirements: "Personal only. 3 attempts.",
  contactInfo: "918-555-0100 roommate",
  homeAddress: "123 Main St, Tulsa, OK",
  workAddress: "456 Work Ave",
  personToServe: "Lonnie Eugene Boyles Jr",
  assignedServer: "test",
  hideClient: false,
  clientName: "Secret Client LLC",
  clientPhone: "555-1212",
};

test("generic street sheet: person, case, papers, addresses, phones — no client", () => {
  const html = generateFieldSheetHtml(sample);

  expect(html).toContain("Party To Serve");
  expect(html).toContain("PG-26-22");
  expect(html).toContain("Lonnie Eugene Boyles Jr");
  expect(html).toContain("Summons");
  expect(html).toContain("Petition");
  expect(html).toContain("123 Main St, Tulsa, OK");
  expect(html).toContain("456 Work Ave");
  expect(html).toContain("918-555-0100 roommate");
  expect(html).toContain("Personal only");
  expect(html).toContain("3 attempts");
  expect(html).toContain("Evenings only");
  expect(html).toContain("original quoted amount");
  expect(html).toContain("(539) 367-6832");
  expect(html).toContain("Physical Description");
  expect(html).toContain("Served To:");
  expect(html).toContain('name="viewport"');
  expect(html).not.toContain("maximum-scale=1");
  expect(html).not.toContain("Client Reference");
  expect(html).not.toContain("Secret Client LLC");
  expect(html).not.toContain("555-1212");
  expect(html).not.toContain("Max Fee Authorized");
  expect(html.indexOf("Party To Serve")).toBeLessThan(html.indexOf("Documents Included"));
  expect(html.indexOf("Documents Included")).toBeLessThan(html.indexOf("original quoted amount"));
});

test("empty phone hides the phone box", () => {
  const html = generateFieldSheetHtml({ ...sample, contactInfo: "" });
  expect(html).not.toContain("Servee Phone / Contact");
  expect(html).toContain("Party To Serve");
});

test("numbered rules keep '3 attempts' as one item", () => {
  const html = generateFieldSheetHtml({
    ...sample,
    requirements: "1. Personal only 2. 3 attempts before posting",
  });
  expect(html).toContain("Personal only");
  expect(html).toContain("3 attempts before posting");
  expect(html).not.toContain("<li>1</li>");
  expect(html).not.toContain("<li>2</li>");
  expect(html).not.toContain("<li>3</li>");
});
