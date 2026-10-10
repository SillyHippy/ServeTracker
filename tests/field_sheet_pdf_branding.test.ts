import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { generateFieldSheetPdf } from "../src/utils/fieldSheetPdfEngine";

const payload = {
  caseNumber: "ISO-1",
  courtName: "Test Court",
  personToServe: "Probe Person",
  homeAddress: "1 Test St",
};

async function pdfText(bytes: Uint8Array, path: string): Promise<string> {
  writeFileSync(path, bytes);
  const proc = Bun.spawn(["pdftotext", "-layout", path, "-"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exit !== 0) throw new Error(`pdftotext failed (${exit}): ${stderr}`);
  return stdout;
}

test("PDF field sheet uses the tenant's name and phone, never the default firm's", async () => {
  const bytes = await generateFieldSheetPdf({
    ...payload,
    branding: { agencyName: "Northwind Process Service", agencyPhone: "(555) 010-0000" },
  });
  const text = await pdfText(bytes, "/tmp/iso_fieldsheet.pdf");
  expect(text).toContain("Northwind");
  expect(text).toContain("(555) 010-0000");
  expect(text).not.toContain("Just Legal Solutions");
  expect(text).not.toContain("367-6832");
  expect(text.toLowerCase()).not.toContain("justlegalsolutions");
});

test("PDF field sheet without branding still uses the default firm", async () => {
  const bytes = await generateFieldSheetPdf(payload);
  const text = await pdfText(bytes, "/tmp/iso_fieldsheet_default.pdf");
  expect(text).toContain("Just Legal Solutions");
});
