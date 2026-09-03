import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { FieldSheetPayload } from "./fieldSheetEngine";

function clean(val: unknown): string {
  return String(val ?? "").trim();
}

/**
 * Generates a clean, professional, single-page Letter PDF (612 x 792 pt)
 * for the Field Sheet using pdf-lib.
 */
export async function generateFieldSheetPdf(data: FieldSheetPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // Standard US Letter (8.5 x 11 in)

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0, 0, 0);
  const darkGray = rgb(0.2, 0.2, 0.2);
  const lightGray = rgb(0.9, 0.9, 0.9);
  const borderGray = rgb(0.7, 0.7, 0.7);
  const amberBg = rgb(1, 0.98, 0.92);

  const margin = 36; // 0.5 in margins
  const contentWidth = 612 - margin * 2; // 540 pt
  let y = 792 - margin; // 756 pt

  // ================= 1. HEADER =================
  // Left side: Company Name + Contact
  page.drawText("JUST LEGAL SOLUTIONS", {
    x: margin,
    y: y - 14,
    size: 16,
    font: fontBold,
    color: black,
  });

  page.drawText("(539) 367-6832 | Info@JustLegalSolutions.org", {
    x: margin,
    y: y - 28,
    size: 9,
    font: fontRegular,
    color: darkGray,
  });

  // Right side: Field Sheet Badge & Case #
  const badgeWidth = 110;
  const badgeHeight = 20;
  const badgeX = 612 - margin - badgeWidth;
  page.drawRectangle({
    x: badgeX,
    y: y - 20,
    width: badgeWidth,
    height: badgeHeight,
    color: black,
  });
  page.drawText("FIELD SHEET", {
    x: badgeX + 18,
    y: y - 15,
    size: 11,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  const caseNumText = `Case: ${clean(data.caseNumber) || "N/A"}`;
  page.drawText(caseNumText, {
    x: 612 - margin - fontBold.widthOfTextAtSize(caseNumText, 11),
    y: y - 36,
    size: 11,
    font: fontBold,
    color: black,
  });

  y -= 46;

  // Divider Line
  page.drawLine({
    start: { x: margin, y },
    end: { x: 612 - margin, y },
    thickness: 1.5,
    color: black,
  });

  y -= 10;

  // ================= 2. TARGET BANNER BOX =================
  const bannerHeight = 64;
  page.drawRectangle({
    x: margin,
    y: y - bannerHeight,
    width: contentWidth,
    height: bannerHeight,
    color: amberBg,
    borderColor: black,
    borderWidth: 1.5,
  });

  // Target Recipient Name
  const targetLabel = "TARGET RECIPIENT TO SERVE:";
  page.drawText(targetLabel, {
    x: margin + 8,
    y: y - 14,
    size: 8.5,
    font: fontBold,
    color: darkGray,
  });

  const targetName = (
    clean(data.personToServe) ||
    (Array.isArray(data.recipients) && data.recipients.length > 1 ? data.recipients.map(r => r.full_name).filter(Boolean).join(" & ") : "") ||
    clean(data.defendant) ||
    clean(data.caseName) ||
    "N/A"
  ).toUpperCase();
  page.drawText(targetName.slice(0, 42), {
    x: margin + 8,
    y: y - 32,
    size: 15,
    font: fontBold,
    color: black,
  });

  // Server Info
  const serverText = `Assigned Server: ${clean(data.assignedServer) || "Field Operations"}`;
  page.drawText(serverText, {
    x: margin + 8,
    y: y - 50,
    size: 9.5,
    font: fontBold,
    color: darkGray,
  });

  // Phone / Contact Box on Right
  if (data.contactInfo) {
    const phoneBoxW = 175;
    const phoneBoxH = 48;
    const phoneBoxX = 612 - margin - phoneBoxW - 8;
    const phoneBoxY = y - bannerHeight + 8;

    page.drawRectangle({
      x: phoneBoxX,
      y: phoneBoxY,
      width: phoneBoxW,
      height: phoneBoxH,
      color: rgb(1, 1, 1),
      borderColor: black,
      borderWidth: 1,
    });

    page.drawText("CONTACT / PHONE:", {
      x: phoneBoxX + 6,
      y: phoneBoxY + phoneBoxH - 11,
      size: 7.5,
      font: fontBold,
      color: darkGray,
    });

    const contactLines = wrapText(clean(data.contactInfo), fontBold, 9, phoneBoxW - 12);
    contactLines.slice(0, 2).forEach((line, idx) => {
      page.drawText(line, {
        x: phoneBoxX + 6,
        y: phoneBoxY + phoneBoxH - 23 - idx * 11,
        size: 9,
        font: fontBold,
        color: black,
      });
    });
  }

  y -= (bannerHeight + 10);

  // ================= 3. ADDRESS BOXES (2 COLUMNS) =================
  const colW = (contentWidth - 8) / 2;
  const addrBoxH = 50;

  // Home / Service Address
  page.drawRectangle({
    x: margin,
    y: y - addrBoxH,
    width: colW,
    height: addrBoxH,
    color: rgb(1, 1, 1),
    borderColor: black,
    borderWidth: 1,
  });
  page.drawText("RESIDENTIAL / SERVICE ADDRESS:", {
    x: margin + 6,
    y: y - 12,
    size: 8,
    font: fontBold,
    color: darkGray,
  });
  const homeLines = wrapText(clean(data.homeAddress) || "None listed", fontBold, 10, colW - 12);
  homeLines.slice(0, 2).forEach((line, idx) => {
    page.drawText(line, {
      x: margin + 6,
      y: y - 26 - idx * 12,
      size: 10,
      font: fontBold,
      color: black,
    });
  });

  // Work / Alternate Address
  const rightColX = margin + colW + 8;
  page.drawRectangle({
    x: rightColX,
    y: y - addrBoxH,
    width: colW,
    height: addrBoxH,
    color: rgb(1, 1, 1),
    borderColor: black,
    borderWidth: 1,
  });
  page.drawText("WORK / ALTERNATE ADDRESS:", {
    x: rightColX + 6,
    y: y - 12,
    size: 8,
    font: fontBold,
    color: darkGray,
  });
  const workLines = wrapText(clean(data.workAddress) || "None listed", fontBold, 10, colW - 12);
  workLines.slice(0, 2).forEach((line, idx) => {
    page.drawText(line, {
      x: rightColX + 6,
      y: y - 26 - idx * 12,
      size: 10,
      font: fontBold,
      color: black,
    });
  });

  y -= (addrBoxH + 8);

  // ================= 4. CASE CAPTION & INSTRUCTIONS =================
  const detailsBoxH = 76;
  page.drawRectangle({
    x: margin,
    y: y - detailsBoxH,
    width: contentWidth,
    height: detailsBoxH,
    color: rgb(0.98, 0.98, 0.98),
    borderColor: borderGray,
    borderWidth: 1,
  });

  // Court Caption
  const courtText = `Court: ${clean(data.courtName) || "Oklahoma District Court"}`;
  page.drawText(courtText.slice(0, 110), {
    x: margin + 6,
    y: y - 13,
    size: 8.5,
    font: fontBold,
    color: black,
  });

  const partiesText = `Parties: ${clean(data.plaintiff) || "Plaintiff"} v. ${clean(data.defendant) || "Defendant"}`;
  page.drawText(partiesText.slice(0, 110), {
    x: margin + 6,
    y: y - 25,
    size: 8.5,
    font: fontRegular,
    color: darkGray,
  });

  // Documents to Serve (wrapped so multi-doc lists never cut off)
  const docsPrefix = "Docs to Serve: ";
  const docsVal = clean(data.documents) || "Summons and Petition";
  const docsLines = wrapText(`${docsPrefix}${docsVal}`, fontBold, 8.5, contentWidth - 14);
  docsLines.slice(0, 2).forEach((line, idx) => {
    page.drawText(line, {
      x: margin + 6,
      y: y - 37 - idx * 11,
      size: 8.5,
      font: fontBold,
      color: rgb(0.1, 0.3, 0.7),
    });
  });

  // Instructions / Requirements
  const nextYOffset = 37 + Math.min(docsLines.length, 2) * 11 + 1;
  const instrText = `Requirements: ${clean(data.requirements) || clean(data.notes) || "Standard personal or substitute service"}`;
  page.drawText(instrText.slice(0, 110), {
    x: margin + 6,
    y: y - nextYOffset,
    size: 8,
    font: fontRegular,
    color: darkGray,
  });

  y -= (detailsBoxH + 10);

  // ================= 5. SERVICE ATTEMPTS TABLE =================
  page.drawText("FIELD ATTEMPT LOG (Record GPS, Date/Time & Server Notes for Affidavit):", {
    x: margin,
    y: y - 10,
    size: 9,
    font: fontBold,
    color: black,
  });

  y -= 16;

  const tableH = 175;
  page.drawRectangle({
    x: margin,
    y: y - tableH,
    width: contentWidth,
    height: tableH,
    color: rgb(1, 1, 1),
    borderColor: black,
    borderWidth: 1.2,
  });

  // Table Header Row
  const headerH = 18;
  page.drawRectangle({
    x: margin,
    y: y - headerH,
    width: contentWidth,
    height: headerH,
    color: lightGray,
  });

  page.drawText("ATT #", { x: margin + 6, y: y - 13, size: 8, font: fontBold, color: black });
  page.drawText("DATE & TIME", { x: margin + 45, y: y - 13, size: 8, font: fontBold, color: black });
  page.drawText("LOCATION / ADDRESS", { x: margin + 140, y: y - 13, size: 8, font: fontBold, color: black });
  page.drawText("OBSERVATIONS / PERSON CONTACTED / RESULT", { x: margin + 300, y: y - 13, size: 8, font: fontBold, color: black });

  // 4 Attempt Rows
  const rowH = (tableH - headerH) / 4; // ~39.25 pt per row
  for (let i = 0; i < 4; i++) {
    const rowY = y - headerH - (i * rowH);

    // Row divider
    page.drawLine({
      start: { x: margin, y: rowY },
      end: { x: 612 - margin, y: rowY },
      thickness: 0.8,
      color: borderGray,
    });

    // Attempt number
    page.drawText(`#${i + 1}`, {
      x: margin + 12,
      y: rowY - 18,
      size: 9,
      font: fontBold,
      color: darkGray,
    });

    // Date/Time blanks
    page.drawText("Date: _____/_____/____", { x: margin + 45, y: rowY - 14, size: 8, font: fontRegular, color: borderGray });
    page.drawText("Time: ____:____ AM/PM", { x: margin + 45, y: rowY - 26, size: 8, font: fontRegular, color: borderGray });

    // Address & Notes lines
    page.drawLine({ start: { x: margin + 140, y: rowY - 18 }, end: { x: margin + 285, y: rowY - 18 }, thickness: 0.5, color: borderGray });
    page.drawLine({ start: { x: margin + 300, y: rowY - 18 }, end: { x: 612 - margin - 8, y: rowY - 18 }, thickness: 0.5, color: borderGray });
    page.drawLine({ start: { x: margin + 300, y: rowY - 30 }, end: { x: 612 - margin - 8, y: rowY - 30 }, thickness: 0.5, color: borderGray });
  }

  y -= (tableH + 10);

  // ================= 6. PHYSICAL DESCRIPTION CHECKLIST =================
  const descBoxH = 46;
  page.drawRectangle({
    x: margin,
    y: y - descBoxH,
    width: contentWidth,
    height: descBoxH,
    color: rgb(1, 1, 1),
    borderColor: borderGray,
    borderWidth: 1,
  });

  page.drawText("PHYSICAL DESCRIPTION OF PERSON SERVED:", {
    x: margin + 6,
    y: y - 12,
    size: 8,
    font: fontBold,
    color: darkGray,
  });

  page.drawText("Age: [   ]  |  Sex: [ M / F ]  |  Height: [      ]  |  Weight: [      ]  |  Hair: [            ]  |  Eyes: [         ]  |  Glasses: [ Y / N ]", {
    x: margin + 6,
    y: y - 26,
    size: 8.5,
    font: fontRegular,
    color: black,
  });

  page.drawText("Military Status: [  ] Active Duty   [  ] Not Active   |   Relationship: [  ] Defendant/Subject   [  ] Spouse/Co-Resident", {
    x: margin + 6,
    y: y - 38,
    size: 8.5,
    font: fontRegular,
    color: black,
  });

  y -= (descBoxH + 10);

  // ================= 7. FOOTER NOTICE =================
  const notice =
    "NOTICE: If service will exceed quoted amount or requires special skip-tracing, contact Just Legal Solutions at (539) 367-6832 before proceeding.";
  page.drawText(notice, {
    x: margin,
    y: y - 10,
    size: 7.5,
    font: fontBold,
    color: darkGray,
  });

  return await doc.save();
}

function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, size);
    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [""];
}
