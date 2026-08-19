import type { ServeAttemptData } from "../types/ServeAttemptData";

export type AffidavitKind = "service" | "non-service";

export interface AffidavitPayload {
  case: {
    case_number: string;
    case_name: string;
    court_name?: string;
    plaintiff_petitioner?: string;
    defendant_respondent?: string;
    documents_to_serve?: string;
  };
  client?: {
    name: string;
    email?: string;
  };
  recipient?: {
    full_name: string;
    role?: string;
    home_address?: string;
    work_address?: string;
  };
  attempts: ServeAttemptData[];
  /** When printing — defaults to "now" for Subscribed and sworn line */
  swornDate?: Date | string;
  notaryBlock?: {
    serverName: string;
    /** Process server license under Joseph's signature (e.g. PSL-2026-2) */
    licenseNumber?: string;
    /** Optional — stamp is usually enough; omit from printed block by default */
    commissionNumber?: string;
    commissionExpiration?: string;
    notaryName?: string;
    state: string;
    county: string;
  };
  /**
   * The assigned process server's saved e-signature. When present it is
   * embedded ONLY into the left process-server signature line; the notary
   * line always stays blank (wet ink / stamp by the real notary).
   */
  signature?: {
    dataUrl: string;
    mimeType: string;
  };
  /** Force Affidavit of Service vs Non-Service. Default: inferred from attempts. */
  affidavitKind?: AffidavitKind;
}

function ordinalDay(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}

/** "this 11th day of August, 2026" for the swear line */
export function formatSwornDatePhrase(d: Date = new Date()): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `this ${ordinalDay(d.getDate())} day of ${months[d.getMonth()]}, ${d.getFullYear()}`;
}

function attemptTypeOf(att: ServeAttemptData): string {
  return String(att.attempt_type || att.attemptType || "physical").toLowerCase();
}

function attemptStatus(att: Pick<ServeAttemptData, "status"> | Record<string, unknown>): string {
  return String((att as ServeAttemptData).status || "").toLowerCase();
}

function attemptMethod(att: ServeAttemptData | Record<string, unknown>): string {
  const row = att as ServeAttemptData;
  return String(row.service_method || row.serviceMethod || "").toLowerCase().trim();
}

export function attemptOccurredMs(att: ServeAttemptData | Record<string, unknown>): number {
  const row = att as ServeAttemptData;
  const raw = (row.occurred_at || row.occurredAt || row.timestamp) as string | Date | undefined;
  const t = raw instanceof Date ? raw.getTime() : new Date(String(raw || "")).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** True when the row is a successful serve (not an unsuccessful attempt). */
export function isSuccessfulServe(att: ServeAttemptData | Record<string, unknown>): boolean {
  const status = attemptStatus(att);
  if (status !== "completed" && status !== "served") return false;
  const method = attemptMethod(att);
  // Completed-without-a-method is not a successful serve — it used to flip
  // the affidavit to Service and then warn "METHOD NOT RECORDED".
  if (!method || method === "non-service") return false;
  return true;
}

/** Most recent successful serve by occurred_at — never the oldest in an unsorted list. */
export function latestSuccessfulServe(
  attempts: Array<ServeAttemptData | Record<string, unknown>>
): ServeAttemptData | Record<string, unknown> | null {
  const successful = attempts.filter(isSuccessfulServe);
  if (successful.length === 0) return null;
  return [...successful].sort((a, b) => attemptOccurredMs(a) - attemptOccurredMs(b)).at(-1) || null;
}

export function inferAffidavitKind(
  attempts: Array<ServeAttemptData | Record<string, unknown>>,
  override?: AffidavitKind | string | null
): AffidavitKind {
  const forced = String(override || "").toLowerCase();
  if (forced === "non-service" || forced === "nonservice") return "non-service";
  if (forced === "service") return "service";
  return latestSuccessfulServe(attempts) ? "service" : "non-service";
}

/** Human label for a service_method value ('' = legacy/unknown). */
export function serviceMethodLabel(method?: string | null): string {
  const labels: Record<string, string> = {
    personal: "Personal Service",
    "substituted-residence": "Substitute (Residence)",
    "substituted-business": "Substitute (Business)",
    corporate: "Corporate / Registered Agent",
    posting: "Posting",
    "non-service": "Non-Service",
  };
  return labels[String(method || "").toLowerCase()] || "";
}

/** True when this method requires the name of the person who received the papers. */
export function methodRequiresAcceptedBy(method?: string | null): boolean {
  return ["substituted-residence", "substituted-business", "corporate"].includes(
    String(method || "").toLowerCase()
  );
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Build the sworn execution sentence for the successful serve based on the
 * recorded method of service. NEVER defaults to "personal" for unknown/legacy
 * rows — that produced false affidavits. Joseph refuses to sign a lie.
 */
function executionSentence(
  method: string,
  recipientName: string,
  acceptedBy: string,
  refusedToIdentify: boolean,
  physicalDescription: string,
  documentsLine: string,
  extraOptions?: {
    postingLocation?: string;
    entityName?: string;
    recipientTitle?: string;
  }
): string {
  const docs = documentsLine
    ? "true and correct copies of the documents listed above"
    : "true and correct copies of the documents";
  const name = esc(recipientName);
  const accepted = esc(acceptedBy.trim());
  const postLoc = esc(extraOptions?.postingLocation?.trim() || "the front entrance door");
  const entity = esc(extraOptions?.entityName?.trim() || recipientName);
  const title = esc(extraOptions?.recipientTitle?.trim() || "Registered Agent");

  switch (method) {
    case "personal":
      return `I executed personal service upon <strong>${name}</strong> by personally delivering ${docs} to <strong>${name}</strong>.`;
    case "substituted-residence": {
      if (refusedToIdentify) {
        return `I executed substituted service upon <strong>${name}</strong> by leaving ${docs} at the dwelling house or usual place of abode of <strong>${name}</strong> with an adult member of the household over the age of 15 who refused to identify himself/herself, and I explained the general nature of the papers.`;
      }
      if (!accepted) {
        const phys = physicalDescription.trim();
        if (phys) {
          return `I executed substituted service upon <strong>${name}</strong> by leaving ${docs} at the dwelling house or usual place of abode of <strong>${name}</strong> with a member of the household over the age of 15 described as ${esc(
            phys
          )}, who was not identified by name, and I explained the general nature of the papers.`;
        }
        return `I executed substituted service upon <strong>${name}</strong> by leaving ${docs} at the dwelling house or usual place of abode of <strong>${name}</strong> with a member of the household over the age of 15, and I explained the general nature of the papers.`;
      }
      return `I executed substituted service upon <strong>${name}</strong> by leaving ${docs} at the dwelling house or usual place of abode of <strong>${name}</strong> with ${accepted}, a member of the household over the age of 15, and I explained the general nature of the papers.`;
    }
    case "substituted-business":
      return `I executed substituted service upon <strong>${name}</strong> by leaving, during office hours, ${docs} at the office of <strong>${name}</strong> with ${
        accepted || "the person apparently in charge thereof"
      }, the person apparently in charge thereof.`;
    case "corporate":
      return `I executed service of process upon <strong>${entity}</strong> by delivering ${docs} to <strong>${
        accepted || "the authorized agent"
      }</strong>, the <strong>${title}</strong> authorized to accept service on behalf of <strong>${entity}</strong>.`;
    case "posting":
      return `I executed service upon <strong>${name}</strong> by posting ${docs} in a conspicuous manner upon ${postLoc} of the premises.`;
    case "non-service":
      return `After due search, careful inquiry and diligent attempts at the address(es) listed above, I have been unable to effect process upon <strong>${name}</strong> because of the reason(s) recorded above.`;
    default:
      // Legacy row with no method recorded — do NOT assert a method.
      return `<span style="color:#b45309;font-weight:bold;">METHOD OF SERVICE NOT RECORDED — verify the method of service before signing.</span>`;
  }
}

function isPhysicalRow(att: ServeAttemptData): boolean {
  const t = attemptTypeOf(att);
  // Phone / neighbor / management stay out of attempt cards — go in Comments
  return t === "physical" || t === "other" || t === "";
}

/** Every physical attempt, oldest first. Do not cap — dropping newest rows hid later serves. */
export function physicalAttemptsForAffidavit(attempts: ServeAttemptData[]): ServeAttemptData[] {
  const sorted = [...attempts].sort((a, b) => attemptOccurredMs(a) - attemptOccurredMs(b));
  return sorted.filter(isPhysicalRow);
}

export function generateAffidavitHtml(data: AffidavitPayload): string {
  const c = data.case;
  const notary = {
    serverName: "Joseph Iannazzi",
    licenseNumber: "PSL-2026-2",
    state: "OKLAHOMA",
    county: "TULSA",
    ...(data.notaryBlock || {}),
  };

  const sworn =
    data.swornDate instanceof Date
      ? data.swornDate
      : data.swornDate
        ? new Date(data.swornDate)
        : new Date();
  const swornPhrase = formatSwornDatePhrase(
    Number.isNaN(sworn.getTime()) ? new Date() : sworn
  );

  const recipientName =
    data.recipient?.full_name || c.defendant_respondent || c.case_name || "TARGET RECIPIENT";

  const sortedAttempts = [...data.attempts].sort((a, b) => attemptOccurredMs(a) - attemptOccurredMs(b));

  const kind = inferAffidavitKind(data.attempts, data.affidavitKind);
  const hasSuccessfulServe = kind === "service";

  // Most-recent successful serve by date carries the method + who accepted.
  const servedAttempt = (latestSuccessfulServe(sortedAttempts) || null) as ServeAttemptData | null;
  const serviceMethod = String(
    servedAttempt?.service_method || servedAttempt?.serviceMethod || ""
  ).toLowerCase();
  const acceptedBy = String(
    servedAttempt?.accepted_by || servedAttempt?.acceptedBy || ""
  );
  const refusedToIdentify = Boolean(
    servedAttempt?.refused_to_identify || servedAttempt?.refusedToIdentify
  );
  const physicalDescription = String(
    servedAttempt?.physical_description || servedAttempt?.physicalDescription || ""
  );
  const title = hasSuccessfulServe
    ? "AFFIDAVIT OF SERVICE"
    : "AFFIDAVIT OF NON-SERVICE";

  const physicalAttempts = physicalAttemptsForAffidavit(sortedAttempts);
  const narrativeAttempts = sortedAttempts.filter((a) => !isPhysicalRow(a));

  const documentsLine = (c.documents_to_serve || "").trim();

  // Service address once (not per attempt row) — same idea as the fillable form
  const serviceAddress =
    physicalAttempts
      .map((a) => a.service_address || a.address || a.home_address)
      .find((a) => a && String(a).trim()) ||
    data.recipient?.home_address ||
    "";

  const fmtAttemptDt = (att: ServeAttemptData) => {
    const raw = (att.occurred_at || att.occurredAt || att.timestamp) as string;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "—";
    // Compact: M/D/YYYY h:mm AM/PM CT
    return d.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Comments: physical notes/results + phone/neighbor/management narrative
  const commentsParts: string[] = [];
  physicalAttempts.forEach((att, idx) => {
    const notes = (att.notes || "").trim();
    if (!notes) return;
    commentsParts.push(`Attempt ${idx + 1} (${fmtAttemptDt(att)}): ${notes}`);
  });
  narrativeAttempts.forEach((att) => {
    const type = attemptTypeOf(att).toUpperCase();
    const notes = (att.notes || "").trim();
    const contact = att.contact_person || att.contactPerson
      ? ` (spoke with ${att.contact_person || att.contactPerson})`
      : "";
    commentsParts.push(
      `${fmtAttemptDt(att)} — ${type}${contact}${notes ? `: ${notes}` : ""}`
    );
  });
  const commentsBlock = commentsParts.join("\n");

  const exhibits: { attemptNum: number; dateStr: string; photoUrl: string; pos: number }[] = [];
  physicalAttempts.forEach((att, idx) => {
    const dStr = fmtAttemptDt(att);
    if (att.photos && att.photos.length > 0) {
      att.photos.forEach((p) => {
        if (p.imageUrl || p.image_url) {
          exhibits.push({
            attemptNum: idx + 1,
            dateStr: dStr,
            photoUrl: p.imageUrl || p.image_url,
            pos: p.position,
          });
        }
      });
    } else if (att.imageUrl || att.image_url) {
      exhibits.push({
        attemptNum: idx + 1,
        dateStr: dStr,
        photoUrl: (att.imageUrl || att.image_url)!,
        pos: 1,
      });
    }
  });

  // Compact attempt bars: Attempt N | Date & Time only (like the fillable template)
  const attemptRowsHtml =
    physicalAttempts.length === 0
      ? `<tr><td colspan="2"><em>No physical field attempts logged.</em></td></tr>`
      : physicalAttempts
          .map(
            (att, idx) => `
            <tr>
              <td class="att-num">Attempt ${idx + 1}</td>
              <td class="att-dt">${fmtAttemptDt(att)}</td>
            </tr>`
          )
          .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} - ${c.case_number}</title>
  <style>
    /* COMPACT LAYOUT (2026-08-15): tighter margins/type so the sworn body +
       signature/notary block fits one letter page with stamp room. */
    body { font-family: 'Times New Roman', Times, serif; font-size: 10pt; line-height: 1.18; color: #000; margin: 18px; }
    .header { text-align: center; font-weight: bold; margin-bottom: 6px; text-transform: uppercase; }
    .caption-box { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    .caption-box td { vertical-align: top; padding: 2px; }
    .caption-left { width: 55%; border-right: 2px solid #000; padding-right: 10px; }
    .caption-right { width: 45%; padding-left: 10px; }
    .title { text-align: center; font-weight: bold; font-size: 11.5pt; margin: 6px 0; text-decoration: underline; }
    .section-title { font-weight: bold; margin-top: 5px; margin-bottom: 2px; text-transform: uppercase; font-size: 9pt; }
    .addr-line { font-size: 9.5pt; margin: 2px 0 5px 0; }
    /* Tight date/time bars — same spirit as the AcroForm attempt cards */
    table.attempts { width: 100%; border-collapse: collapse; margin: 4px 0 6px 0; font-size: 9.5pt; }
    table.attempts th, table.attempts td { border: 1px solid #333; padding: 2px 6px; text-align: left; vertical-align: middle; }
    table.attempts th { background-color: #f2f2f2; text-transform: uppercase; font-size: 8pt; }
    table.attempts td.att-num { width: 28%; font-weight: bold; white-space: nowrap; }
    table.attempts td.att-dt { width: 72%; }
    .comments { font-size: 9.5pt; white-space: pre-wrap; border: 1px solid #333; padding: 5px; min-height: 52px; }
    .sig-block { margin-top: 10px; page-break-inside: avoid; }
    .sig-line { border-bottom: 1px solid #000; width: 280px; height: 72px; margin-top: 14px; display: flex; align-items: flex-end; }
    .exhibit-page { page-break-before: always; text-align: center; }
    .exhibit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
    .exhibit-card { border: 1px solid #ccc; padding: 6px; background: #fafafa; }
    .exhibit-card img { max-width: 100%; max-height: 210px; object-fit: contain; }
    @media print {
      body { margin: 0.35in; }
      .exhibit-page { page-break-before: always; }
    }
  </style>
</head>
<body>

  <div class="header">
    ${c.court_name ? String(c.court_name).toUpperCase() : "IN THE DISTRICT COURT OF OKLAHOMA"}
  </div>

  <table class="caption-box">
    <tr>
      <td class="caption-left">
        <strong>${c.plaintiff_petitioner || "PETITIONER / PLAINTIFF"}</strong>,<br>
        <em>Plaintiff/Petitioner</em>,<br><br>
        vs.<br><br>
        <strong>${c.defendant_respondent || recipientName}</strong>,<br>
        <em>Defendant/Respondent</em>.
      </td>
      <td class="caption-right">
        <strong>CASE NO. ${c.case_number}</strong><br><br>
        <strong>PERSON SERVED / ATTEMPTED:</strong><br>${recipientName}
      </td>
    </tr>
  </table>

  <div class="title">${title}</div>

  <p>
    I, <strong>${notary.serverName}</strong>, being duly sworn, depose and state that I am a duly licensed
    Private Process Server in the State of ${notary.state}
    (License No. <strong>${notary.licenseNumber || "PSL-2026-2"}</strong>), over the age of eighteen (18) years,
    and not a party to nor interested in the outcome of the above-entitled action.
  </p>

  ${
    documentsLine
      ? `<div class="section-title">Documents</div>
         <p>${documentsLine.replace(/\n/g, "<br>")}</p>`
      : `<div class="section-title">Documents</div>
         <p><em>(List documents to serve on the case record — Add/Edit Case → Documents to Serve.)</em></p>`
  }

  ${
    serviceAddress
      ? `<div class="addr-line"><strong>Service Address:</strong> ${serviceAddress}</div>`
      : ""
  }

  <div class="section-title">Service Attempts (Physical)</div>
  <table class="attempts">
    <thead>
      <tr>
        <th>Attempt</th>
        <th>Date &amp; Time</th>
      </tr>
    </thead>
    <tbody>
      ${attemptRowsHtml}
    </tbody>
  </table>

  <div class="section-title">Comments</div>
  <div class="comments">${
    commentsBlock
      ? commentsBlock.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      : "&nbsp;"
  }</div>

  <p>
    ${
      hasSuccessfulServe
        ? executionSentence(
            serviceMethod,
            recipientName,
            acceptedBy,
            refusedToIdentify,
            physicalDescription,
            documentsLine,
            {
              postingLocation: (servedAttempt as any)?.posting_location || (servedAttempt as any)?.postingLocation,
              entityName: (servedAttempt as any)?.entity_name || (servedAttempt as any)?.entityName,
              recipientTitle: (servedAttempt as any)?.recipient_title || (servedAttempt as any)?.recipientTitle,
            }
          )
        : `After due diligence at the known address(es), I have been unable to effect personal service upon <strong>${recipientName}</strong> for the reasons in the log above.`
    }
  </p>

  <div class="sig-block">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <!-- Process server LEFT -->
        <td width="48%" valign="top">
          ${
            data.signature
              ? `<div class="sig-line" style="padding:0 2px 1px 2px;"><img src="${data.signature.dataUrl}" alt="Process Server Signature" style="height:64px;max-width:270px;width:auto;object-fit:contain;object-position:bottom;display:block;"/></div>`
              : `<div class="sig-line"></div>`
          }
          <div style="margin-top:6px;">
            <strong>${notary.serverName}</strong><br>
            Private Process Server<br>
            License No. ${notary.licenseNumber || "PSL-2026-2"}<br>
            Just Legal Solutions
          </div>
        </td>
        <td width="4%"></td>
        <!-- Notary RIGHT — wet-ink / stamp only; no typed notary name or commission -->
        <td width="48%" valign="top">
          <p style="font-size:10pt;margin:0 0 8px 0;">
            STATE OF ${notary.state}&nbsp;&nbsp;)<br>
            COUNTY OF ${notary.county}&nbsp;)&nbsp;ss.
          </p>
          <p style="font-size:10pt;margin:0;">
            Subscribed and sworn to before me ${swornPhrase}.
          </p>
          <div class="sig-line"></div>
          <div style="margin-top:6px;font-size:10pt;">
            Notary Public
          </div>
        </td>
      </tr>
    </table>
  </div>

  ${
    exhibits.length > 0
      ? `
    <div class="exhibit-page">
      <div class="section-title" style="font-size:13pt;margin-top:24px;">EXHIBIT PHOTOS (${exhibits.length})</div>
      <div class="exhibit-grid">
        ${exhibits
          .map(
            (ex) => `
          <div class="exhibit-card">
            <img src="${ex.photoUrl}" alt="Exhibit" />
            <div style="font-size:9pt;margin-top:6px;font-weight:bold;">Attempt #${ex.attemptNum} — Photo #${ex.pos}</div>
            <div style="font-size:8pt;color:#666;">${ex.dateStr}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>`
      : ""
  }

</body>
</html>
  `;
}
