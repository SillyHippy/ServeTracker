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
    /** serve_recipients.id — scopes method resolution to THIS legal recipient. */
    id?: string;
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
  /** Whether to include exhibit photos at the end. Default: true */
  includeExhibits?: boolean;
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

function attemptOccurredMs(att: ServeAttemptData): number {
  const raw = (att.occurred_at || att.occurredAt || att.timestamp) as string;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function recipientIdOf(att: ServeAttemptData): string {
  return String(att.recipient_id || att.recipientId || "").trim();
}

function personServedOf(att: ServeAttemptData): string {
  return String(att.person_being_served || att.personBeingServed || "").trim();
}

/** Rows captured at one physical encounter share this id. '' means unlinked. */
function eventIdOf(att: ServeAttemptData): string {
  return String((att as { event_id?: string; eventId?: string }).event_id ||
    (att as { event_id?: string; eventId?: string }).eventId || "").trim();
}

/** Does this row record a delivery to the recipient the affidavit is about? */
function servesTargetRecipient(
  att: ServeAttemptData,
  targetId: string,
  targetName: string
): boolean {
  const rid = recipientIdOf(att);
  if (targetId && rid) return rid === targetId;
  const pbs = personServedOf(att);
  if (targetName && pbs) return pbs.toLowerCase() === targetName.toLowerCase();
  return false;
}

/**
 * True when the attempt set distinguishes WHO was served, so an unmatched
 * target means "not served" rather than "legacy row with no attribution".
 * Either an explicit recipient_id exists, or the rows name two different
 * people — the multi-recipient shape that made the old global lookup lie.
 */
function attemptsAreRecipientAware(attempts: ServeAttemptData[]): boolean {
  if (attempts.some((a) => recipientIdOf(a) !== "")) return true;
  const names = new Set(
    attempts.map((a) => personServedOf(a).toLowerCase()).filter(Boolean)
  );
  return names.size > 1;
}

/**
 * Return the most-recent COMPLETED serve attempt by occurred_at that carries
 * a service method. If an older completed attempt has no method but a newer
 * completed attempt does, the newer one wins.
 *
 * When a target recipient is supplied the search is scoped to that recipient:
 * two people served at the same stop each get their own method. The global
 * newest completed attempt is used ONLY for legacy rows that carry no
 * recipient attribution at all; on recipient-aware data a target with no
 * completed attempt returns null so the affidavit prints METHOD NOT RECORDED
 * instead of inheriting somebody else's method of service.
 */
export function latestSuccessfulServe(
  attempts: ServeAttemptData[],
  targetRecipientId?: string,
  targetRecipientName?: string
): ServeAttemptData | null {
  const completed = attempts
    .filter((a) => attemptStatus(a) === "completed")
    .sort((a, b) => attemptOccurredMs(b) - attemptOccurredMs(a));
  if (completed.length === 0) return null;

  const pickBest = (rows: ServeAttemptData[]): ServeAttemptData | null => {
    if (rows.length === 0) return null;
    const withMethod = rows.find((a) => Boolean(a.service_method || a.serviceMethod));
    return withMethod || rows[0];
  };

  const targetId = String(targetRecipientId || "").trim();
  const targetName = String(targetRecipientName || "").trim();

  if (targetId || targetName) {
    const scoped = completed.filter((a) => servesTargetRecipient(a, targetId, targetName));
    if (scoped.length > 0) return pickBest(scoped);
    if (attemptsAreRecipientAware(attempts)) return null;
  }

  return pickBest(completed);
}

/**
 * Inferred affidavit kind: "service" if at least one completed attempt has
 * a recorded method of service. If no attempts succeeded (all failed or
 * completed with no method), it is an Affidavit of Non-Service.
 */
export function inferAffidavitKind(
  attempts: ServeAttemptData[],
  overrideKind?: AffidavitKind,
  targetRecipientId?: string,
  targetRecipientName?: string
): AffidavitKind {
  if (overrideKind) return overrideKind;
  const serve = latestSuccessfulServe(attempts, targetRecipientId, targetRecipientName);
  if (!serve) return "non-service";
  const m = String(serve.service_method || serve.serviceMethod || "").trim();
  return m ? "service" : "non-service";
}

export function serviceMethodLabel(methodRaw: string): string {
  const m = methodRaw.toLowerCase().trim();
  switch (m) {
    case "personal":
      return "Personal Delivery";
    case "substituted-residence":
      return "Substituted Service (Residence / Usual Place of Abode)";
    case "substituted-business":
      return "Substituted Service (Business / Office)";
    case "corporate":
      return "Corporate / Registered Agent";
    case "posting":
      return "Posting (Premises)";
    case "non-service":
      return "Non-Service";
    default:
      return m ? `Other (${m})` : "Unspecified";
  }
}

const esc = (s: string) =>
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

function photoKeyOf(p: { id?: string; imageUrl?: string; image_url?: string }): string {
  return String(p.imageUrl || p.image_url || p.id || "");
}

/**
 * Fold a sibling row of the same encounter into the representative row.
 * The representative keeps its own identity and timestamp (it is the oldest
 * row of the event); only evidence that would otherwise be dropped from the
 * packet — photos, notes, and a service address — is carried across.
 */
function mergeEncounterRow(base: ServeAttemptData, extra: ServeAttemptData): ServeAttemptData {
  const merged: ServeAttemptData = { ...base };

  const photos = [...(base.photos || [])];
  for (const p of extra.photos || []) {
    const key = photoKeyOf(p);
    if (!key || !photos.some((existing) => photoKeyOf(existing) === key)) photos.push(p);
  }
  if (photos.length > 0) merged.photos = photos;

  const baseNotes = String(base.notes || "").trim();
  const extraNotes = String(extra.notes || "").trim();
  if (extraNotes && extraNotes !== baseNotes) {
    merged.notes = baseNotes ? `${baseNotes} ${extraNotes}` : extraNotes;
  }

  if (!String(base.service_address || "").trim() && extra.service_address) {
    merged.service_address = extra.service_address;
  }
  if (!String(base.address || "").trim() && extra.address) {
    merged.address = extra.address;
  }

  return merged;
}

/**
 * Every physical attempt, oldest first. Do not cap — dropping newest rows hid later serves.
 * Rows sharing a non-empty event_id are one physical encounter and collapse to a
 * single chronology entry, so serving two recipients at one stop cannot print as
 * two attempts at the same minute.
 */
export function physicalAttemptsForAffidavit(attempts: ServeAttemptData[]): ServeAttemptData[] {
  const sorted = [...attempts].sort((a, b) => attemptOccurredMs(a) - attemptOccurredMs(b));
  const encounters: ServeAttemptData[] = [];
  const slotByEvent = new Map<string, number>();

  for (const att of sorted) {
    if (!isPhysicalRow(att)) continue;
    const eventId = eventIdOf(att);
    if (!eventId) {
      encounters.push(att);
      continue;
    }
    const slot = slotByEvent.get(eventId);
    if (slot === undefined) {
      slotByEvent.set(eventId, encounters.length);
      encounters.push(att);
      continue;
    }
    encounters[slot] = mergeEncounterRow(encounters[slot], att);
  }

  return encounters;
}

export interface ExhibitPhotoItem {
  attemptNum: number;
  dateStr: string;
  photoUrl: string;
  pos: number;
}

export function buildAffidavitSectionHtml(data: AffidavitPayload): {
  sectionHtml: string;
  title: string;
  exhibits: ExhibitPhotoItem[];
} {
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

  const kind = inferAffidavitKind(
    data.attempts,
    data.affidavitKind,
    data.recipient?.id,
    data.recipient?.full_name
  );
  const hasSuccessfulServe = kind === "service";

  // Most-recent successful serve by date carries the method + who accepted —
  // scoped to THIS recipient so a co-served party's method is never borrowed.
  const servedAttempt = (latestSuccessfulServe(
    sortedAttempts,
    data.recipient?.id,
    data.recipient?.full_name
  ) || null) as ServeAttemptData | null;
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

  const exhibits: ExhibitPhotoItem[] = [];
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

  const sectionHtml = `
  <div class="affidavit-packet">
    <div class="header">
      ${c.court_name ? esc(String(c.court_name).toUpperCase()) : "IN THE DISTRICT COURT OF OKLAHOMA"}
    </div>

    <table class="caption-box">
      <tr>
        <td class="caption-left">
          <strong>${esc(c.plaintiff_petitioner || "PETITIONER / PLAINTIFF")}</strong>,<br>
          <em>Plaintiff/Petitioner</em>,<br><br>
          vs.<br><br>
          <strong>${esc(c.defendant_respondent || recipientName)}</strong>,<br>
          <em>Defendant/Respondent</em>.
        </td>
        <td class="caption-right">
          <strong>CASE NO. ${esc(c.case_number)}</strong><br><br>
          <strong>PERSON SERVED / ATTEMPTED:</strong><br>${esc(recipientName)}
        </td>
      </tr>
    </table>

    <div class="title">${esc(title)}</div>

    <p>
      I, <strong>${esc(notary.serverName)}</strong>, being duly sworn, depose and state that I am a duly licensed
      Private Process Server in the State of ${esc(notary.state)}
      (License No. <strong>${esc(notary.licenseNumber || "PSL-2026-2")}</strong>), over the age of eighteen (18) years,
      and not a party to nor interested in the outcome of the above-entitled action.
    </p>

    ${
      documentsLine
        ? `<div class="section-title">Documents</div>
           <p>${esc(documentsLine).replace(/\n/g, "<br>")}</p>`
        : `<div class="section-title">Documents</div>
           <p><em>(List documents to serve on the case record — Add/Edit Case → Documents to Serve.)</em></p>`
    }

    ${
      serviceAddress
        ? `<div class="addr-line"><strong>Service Address:</strong> ${esc(serviceAddress)}</div>`
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
                entityName: (servedAttempt as any)?.entity_name || (servedAttempt as any)?.entityName || (servedAttempt as any)?.corporate_agent || (servedAttempt as any)?.corporateAgent,
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
                ? `<div class="sig-line" style="padding:0 2px 0 2px;position:relative;overflow:visible;"><img src="${data.signature.dataUrl}" alt="Process Server Signature" style="height:62px;max-width:270px;width:auto;object-fit:contain;object-position:bottom;display:block;margin-bottom:-1px;transform:translateY(1px);"/></div>`
                : `<div class="sig-line"></div>`
            }
            <div style="margin-top:6px;">
              <strong>${notary.serverName}</strong><br>
              Private Process Server<br>
              License No. ${notary.licenseNumber || "PSL-2026-2"}<br>
              Just Legal Solutions &bull; (539) 367-6832
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
  </div>`;

  return { sectionHtml, title, exhibits };
}

const COMMON_CSS = `
  body { font-family: 'Times New Roman', Times, serif; font-size: 10pt; line-height: 1.18; color: #000; margin: 18px; }
  .affidavit-packet { page-break-after: always; break-after: page; }
  .affidavit-packet:last-of-type { page-break-after: auto; break-after: auto; }
  .header { text-align: center; font-weight: bold; margin-bottom: 6px; text-transform: uppercase; }
  .caption-box { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .caption-box td { vertical-align: top; padding: 2px; }
  .caption-left { width: 55%; border-right: 2px solid #000; padding-right: 10px; }
  .caption-right { width: 45%; padding-left: 10px; }
  .title { text-align: center; font-weight: bold; font-size: 11.5pt; margin: 6px 0; text-decoration: underline; }
  .section-title { font-weight: bold; margin-top: 5px; margin-bottom: 2px; text-transform: uppercase; font-size: 9pt; }
  .addr-line { font-size: 9.5pt; margin: 2px 0 5px 0; }
  /* Tight date/time bars */
  table.attempts { width: 100%; border-collapse: collapse; margin: 4px 0 6px 0; font-size: 9.5pt; }
  table.attempts th, table.attempts td { border: 1px solid #333; padding: 2px 6px; text-align: left; vertical-align: middle; }
  table.attempts th { background-color: #f2f2f2; text-transform: uppercase; font-size: 8pt; }
  table.attempts td.att-num { width: 28%; font-weight: bold; white-space: nowrap; }
  table.attempts td.att-dt { width: 72%; }
  .comments { font-size: 9.5pt; white-space: pre-wrap; border: 1px solid #333; padding: 5px; min-height: 52px; }
  .sig-block { margin-top: 10px; page-break-inside: avoid; }
  .sig-line { border-bottom: 1px solid #000; width: 280px; height: 72px; margin-top: 14px; display: flex; align-items: flex-end; }
  .exhibit-page { page-break-before: always; break-before: page; text-align: center; }
  .exhibit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
  .exhibit-card { border: 1px solid #ccc; padding: 6px; background: #fafafa; break-inside: avoid; page-break-inside: avoid; }
  .exhibit-card img { max-width: 100%; max-height: 210px; object-fit: contain; }
  @media print {
    body { margin: 0.35in; }
    .exhibit-page { page-break-before: always; break-before: page; }
    @page {
      margin: 0.45in;
    }
  }
`;

export function generateAffidavitHtml(data: AffidavitPayload): string {
  const { sectionHtml, title, exhibits } = buildAffidavitSectionHtml(data);
  const includeExhibits = data.includeExhibits !== false;

  const exhibitsHtml = (includeExhibits && exhibits.length > 0)
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
    : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} - ${data.case.case_number}</title>
  <style>
    ${COMMON_CSS}
  </style>
</head>
<body>
  ${sectionHtml}
  ${exhibitsHtml}
</body>
</html>`;
}

/**
 * Generate a combined batch of affidavits for multiple recipients at the same address.
 * Each recipient gets their own sworn affidavit section (page-break separated),
 * followed by the shared case exhibit photos printed once at the very end.
 * No continuous page numbers are stamped in the footer so each affidavit can be filed cleanly.
 */
export function generateBatchAffidavitsHtml(
  payloads: AffidavitPayload[],
  options?: boolean | { includeExhibits?: boolean }
): string {
  if (payloads.length === 0) return "";
  const includeExhibits = typeof options === "boolean" ? options : options?.includeExhibits !== false;
  let sharedExhibits: ExhibitPhotoItem[] = [];
  const sectionsHtml: string[] = [];

  payloads.forEach((payload, idx) => {
    const { sectionHtml, exhibits } = buildAffidavitSectionHtml({
      ...payload,
      includeExhibits: false, // exhibits rendered once at the end
    });
    // Add page break class between packets except the very last one
    sectionsHtml.push(`
      <div class="${idx < payloads.length - 1 ? 'affidavit-packet' : ''}">
        ${sectionHtml}
      </div>
    `);
    if (exhibits.length > 0) {
      // Deduplicate exhibit photos by URL across all recipient attempts
      for (const ex of exhibits) {
        if (!sharedExhibits.some((se) => se.photoUrl === ex.photoUrl)) {
          sharedExhibits.push(ex);
        }
      }
    }
  });

  const exhibitsHtml = (includeExhibits && sharedExhibits.length > 0)
    ? `
    <div class="exhibit-page">
      <div class="section-title" style="font-size:13pt;margin-top:24px;">CASE EXHIBIT PHOTOS (${sharedExhibits.length})</div>
      <div class="exhibit-grid">
        ${sharedExhibits
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
    : "";

  const caseNumber = payloads[0]?.case?.case_number || "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>AFFIDAVITS BATCH - ${caseNumber}</title>
  <style>
    ${COMMON_CSS}
  </style>
</head>
<body>
  ${sectionsHtml.join("\n")}
  ${exhibitsHtml}
</body>
</html>`;
}
