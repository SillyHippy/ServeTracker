import { expect, test } from "bun:test";
import { generateFieldSheetHtml } from "../src/utils/fieldSheetEngine";

const payload = {
  caseNumber: "ISO-1",
  courtName: "Test Court",
  personToServe: "Probe Person",
  homeAddress: "1 Test St",
};

test("field sheet uses the tenant's name and phone, never the default firm's", () => {
  const html = generateFieldSheetHtml({
    ...payload,
    branding: { agencyName: "Northwind Process Service", agencyPhone: "(555) 010-0000" },
  });
  expect(html).toContain("Northwind Process Service");
  expect(html).toContain("(555) 010-0000");
  expect(html).not.toContain("Just Legal Solutions");
  expect(html).not.toContain("367-6832");
  expect(html.toLowerCase()).not.toContain("justlegalsolutions");
});
