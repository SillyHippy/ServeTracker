import { expect, test } from "bun:test";
import {
  normalizeServiceLevel,
  isValidServiceLevel,
  serviceLevelLabel,
  anyPersonalServiceOnly,
  resolveFieldSheetServiceBadges,
} from "../src/utils/serviceLevel";
import { generateFieldSheetHtml } from "../src/utils/fieldSheetEngine";
import { generateFieldSheetPdf } from "../src/utils/fieldSheetPdfEngine";

test("normalizeServiceLevel defaults and aliases", () => {
  expect(normalizeServiceLevel(undefined)).toBe("standard");
  expect(normalizeServiceLevel("")).toBe("standard");
  expect(normalizeServiceLevel("RUSH")).toBe("rush");
  expect(normalizeServiceLevel("same-day-rush")).toBe("same_day_rush");
  expect(normalizeServiceLevel("same_day")).toBe("same_day_rush");
  expect(normalizeServiceLevel("garbage")).toBe("standard");
});

test("isValidServiceLevel rejects unknown", () => {
  expect(isValidServiceLevel("standard")).toBe(true);
  expect(isValidServiceLevel("rush")).toBe(true);
  expect(isValidServiceLevel("same_day_rush")).toBe(true);
  expect(isValidServiceLevel("overnight")).toBe(false);
});

test("serviceLevelLabel never says PERSONAL by default", () => {
  expect(serviceLevelLabel(undefined)).toBe("STANDARD SERVICE");
  expect(serviceLevelLabel("rush")).toBe("RUSH SERVICE");
  expect(serviceLevelLabel("same_day_rush")).toBe("SAME-DAY RUSH");
});

test("personal only comes only from recipient flag", () => {
  expect(anyPersonalServiceOnly([])).toBe(false);
  expect(anyPersonalServiceOnly([{ personal_service_only: false }])).toBe(false);
  expect(anyPersonalServiceOnly([{ personal_service_only: true }])).toBe(true);
  expect(
    anyPersonalServiceOnly([
      { personal_service_only: false },
      { personalServiceOnly: 1 },
    ])
  ).toBe(true);
});

test("HTML field sheet always shows SERVICE TYPE and never defaults to PERSONAL SERVICE", () => {
  const html = generateFieldSheetHtml({
    caseNumber: "MOCK-2026-1",
    personToServe: "Jane Doe",
    contactInfo: "918-555-0100",
    serviceLevel: "standard",
    recipients: [{ full_name: "Jane Doe", personal_service_only: false }],
  });
  expect(html).toContain("SERVICE TYPE");
  expect(html).toContain("STANDARD SERVICE");
  expect(html).toContain("918-555-0100");
  expect(html).not.toContain("PERSONAL SERVICE ONLY");
  // Must not imply personal as the service-level default
  expect(html).not.toMatch(/svc-val">PERSONAL SERVICE</);
  // Standard is calm — badge element uses svc-standard (CSS may still define other tones)
  expect(html).toMatch(/class="svc-badge svc-standard"/);
  expect(html).not.toMatch(/class="svc-badge[^"]*svc-rush"/);
});

test("HTML rush is red tone; personal-only is separate strip", () => {
  const html = generateFieldSheetHtml({
    caseNumber: "MOCK-2026-2",
    personToServe: "Jane Doe & John Doe",
    serviceLevel: "rush",
    recipients: [
      { full_name: "Jane Doe", personal_service_only: true },
      { full_name: "John Doe", personal_service_only: false },
    ],
  });
  expect(html).toContain("RUSH SERVICE");
  expect(html).toMatch(/class="svc-badge svc-rush[^"]*"/);
  expect(html).toContain("PERSONAL SERVICE ONLY");
  expect(html).toContain("NO SUBSTITUTE SERVICE");
});

test("HTML same-day rush uses louder tone class", () => {
  const html = generateFieldSheetHtml({
    caseNumber: "MOCK-2026-SD",
    personToServe: "Jane Doe",
    serviceLevel: "same_day_rush",
    recipients: [{ full_name: "Jane Doe", personal_service_only: false }],
  });
  expect(html).toContain("SAME-DAY RUSH");
  expect(html).toMatch(/class="svc-badge svc-same-day"/);
  expect(html).not.toMatch(/class="svc-badge[^"]*svc-rush"/);
});

test("HTML standard + personal-only stays svc-standard (not rush-red box)", () => {
  const html = generateFieldSheetHtml({
    caseNumber: "MOCK-2026-PS",
    personToServe: "Jane Doe",
    serviceLevel: "standard",
    recipients: [{ full_name: "Jane Doe", personal_service_only: true }],
  });
  expect(html).toMatch(/class="svc-badge svc-standard svc-personal"/);
  expect(html).toContain("PERSONAL SERVICE ONLY");
  expect(html).not.toMatch(/class="svc-badge[^"]*svc-rush"/);
});

test("PDF generates for contact+rush+personalOnly", async () => {
  const bytes = await generateFieldSheetPdf({
    caseNumber: "MOCK-2026-3",
    personToServe: "Test Subject",
    contactInfo: "539-555-0199 roommate",
    homeAddress: "100 Main St, Tulsa, OK",
    serviceLevel: "same_day_rush",
    assignedServer: "Bill Acox",
    recipients: [{ full_name: "Test Subject", personal_service_only: true }],
  });
  expect(bytes.byteLength).toBeGreaterThan(500);
  // PDF header
  expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
});

test("resolveFieldSheetServiceBadges", () => {
  const b = resolveFieldSheetServiceBadges({
    serviceLevel: "rush",
    recipients: [{ personal_service_only: false }],
  });
  expect(b.serviceTypeLabel).toBe("RUSH SERVICE");
  expect(b.personalOnly).toBe(false);
});
