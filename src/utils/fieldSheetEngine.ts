export type FieldSheetPayload = {
  caseNumber?: string;
  caseName?: string;
  courtName?: string;
  plaintiff?: string;
  defendant?: string;
  documents?: string;
  notes?: string;
  requirements?: string;
  contactInfo?: string;
  homeAddress?: string;
  workAddress?: string;
  personToServe?: string;
  recipients?: Array<{ full_name: string; role?: string }>;
  assignedServer?: string;
  clientName?: string;
  clientPhone?: string;
  hideClient?: boolean;
};

const AGENCY = "JUST LEGAL SOLUTIONS";
const AGENCY_CONTACT = "(539) 367-6832 | Info@JustLegalSolutions.org";
const BILLING_NOTICE =
  "If service would exceed the original quoted amount, please contact Just Legal Solutions at (539) 367-6832 before proceeding.";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function splitList(value: unknown, re: RegExp): string[] {
  return text(value)
    .split(re)
    .map((part) => part.replace(/^[•\-]+\s*/, "").trim())
    .filter(Boolean);
}

/** Keep "3 attempts" and "1. Personal only 2. 3 attempts" as real rules — never split on the digit. */
function splitRules(value: unknown): string[] {
  const raw = text(value);
  if (!raw) return [];

  const strip = (part: string) =>
    part.replace(/^[•\-]+\s*/, "").replace(/^\d+[.)]\s+/, "").trim();

  if (/[\n;]/.test(raw) || /^[•\-]\s/m.test(raw)) {
    return raw.split(/[\n;]+/).map(strip).filter(Boolean);
  }

  const numbered = raw.split(/(?=(?:^|\s)\d+[.)]\s+)/).map(strip).filter(Boolean);
  if (numbered.length > 1) return numbered;

  return raw
    .split(/(?<=\S)\.\s+/)
    .map((part) => part.replace(/\.+$/, "").trim())
    .filter(Boolean);
}

function person(data: FieldSheetPayload): string {
  if (Array.isArray(data.recipients) && data.recipients.length > 1) {
    return data.recipients.map((r) => r.full_name).filter(Boolean).join(" & ");
  }
  return text(data.personToServe) || text(data.defendant) || text(data.caseName);
}

function caseLine(data: FieldSheetPayload): string {
  const num = text(data.caseNumber);
  const court = text(data.courtName);
  if (num && court) return `${num} | ${court}`;
  return num || court;
}

function docsHtml(data: FieldSheetPayload): string {
  const items = splitList(data.documents, /[;\n]+/);
  if (!items.length) return "&nbsp;";
  if (items.length === 1) return esc(items[0]);
  return `<ol class="docs">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>`;
}

function rulesHtml(data: FieldSheetPayload): string {
  const fromReq = splitRules(data.requirements);
  const fromNotes = fromReq.length ? [] : splitRules(data.notes);
  const items = fromReq.length ? fromReq : fromNotes;
  if (!items.length) return `<p class="muted">None listed — write extras on the back.</p>`;
  return `<ul class="rules">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

export function generateFieldSheetHtml(data: FieldSheetPayload): string {
  const who = person(data);
  const phone = text(data.contactInfo);
  const server = text(data.assignedServer);
  const extraNotes = splitRules(data.requirements).length ? text(data.notes) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Field Sheet ${esc(data.caseNumber || "")}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
      font-size: 13px;
      line-height: 1.25;
    }
    .page {
      width: 8.5in;
      max-width: 100%;
      margin: 0 auto;
      padding: 10px 12px 14px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      border-bottom: 2px solid #000;
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .company { font-size: 17px; font-weight: 900; letter-spacing: -0.02em; margin: 0; text-transform: uppercase; }
    .company-contact { font-size: 11px; font-weight: 700; margin: 2px 0 0; }
    .job-meta { text-align: right; }
    .job-badge {
      display: inline-block;
      background: #000;
      color: #fff;
      font-size: 12px;
      font-weight: 900;
      padding: 3px 8px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .serve-by { font-size: 12px; font-weight: 900; margin-top: 4px; }
    .serve-by .blank { border-bottom: 1px solid #000; display: inline-block; min-width: 88px; }

    .banner {
      border: 2px solid #000;
      border-radius: 6px;
      padding: 8px 9px;
      background: #fffbeb;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .server-line { text-align: right; font-size: 11px; font-weight: 800; border-bottom: 1px solid #0003; padding-bottom: 3px; }
    .who-row {
      display: grid;
      grid-template-columns: ${phone ? "1.35fr 0.85fr" : "1fr"};
      gap: 8px;
      align-items: center;
      margin-top: 6px;
    }
    .lab { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #333; display: block; }
    .name { font-size: 22px; font-weight: 900; line-height: 1.05; text-transform: uppercase; }
    .phone-box { border: 2px solid #000; border-radius: 4px; background: #fff; padding: 6px 8px; }
    .phone-val { font-size: 14px; font-weight: 900; letter-spacing: 0.01em; }

    .addr-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 7px; }
    .box { border: 1px solid #000; border-radius: 4px; background: #fff; padding: 6px 7px; min-height: 42px; }
    .box .val { font-size: 13px; font-weight: 800; }

    .mid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
    .panel { border: 2px solid #000; border-radius: 6px; padding: 7px 8px; }
    .panel h3 {
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 2px solid #000;
      margin: 0 0 6px;
      padding-bottom: 3px;
    }
    .panel .val { font-size: 13px; font-weight: 800; }
    .docs { margin: 0; padding-left: 18px; }
    .docs li { font-weight: 800; margin: 1px 0; }
    .rules { margin: 0; padding-left: 16px; }
    .rules li { font-size: 12px; font-weight: 700; margin: 2px 0; }
    .muted { font-size: 12px; font-weight: 600; color: #333; margin: 0; }
    .notes { margin-top: 6px; font-size: 12px; font-weight: 700; }

    .desc { border: 2px solid #000; border-radius: 6px; padding: 7px 8px; margin-top: 8px; }
    .desc h3 { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 6px; }
    .desc-row {
      border: 1px solid #000;
      border-radius: 4px;
      padding: 5px 7px;
      margin-bottom: 5px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 14px;
      font-size: 11px;
      font-weight: 700;
    }
    .desc-row .k { font-size: 9px; font-weight: 900; text-transform: uppercase; min-width: 52px; }
    .veh { display: grid; grid-template-columns: 1.1fr 1.6fr 1.6fr 1.7fr; gap: 6px; font-size: 11px; font-weight: 700; padding-top: 2px; }
    .veh span { border-bottom: 1px solid #000; min-height: 16px; }

    .log { border: 2px solid #000; border-radius: 6px; padding: 7px 8px; margin-top: 8px; }
    .log h3 { font-size: 10px; font-weight: 900; text-transform: uppercase; margin: 0 0 5px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 2px solid #000; padding: 5px 6px; vertical-align: middle; }
    th { background: #000; color: #fff; font-size: 10px; font-weight: 900; text-align: left; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { height: 28px; font-size: 12px; font-weight: 700; }
    .num { width: 28px; text-align: center; }
    .when { width: 28%; }
    .srv { background: #f3f3f3; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    .bill {
      margin-top: 8px;
      border: 1px solid #b91c1c;
      background: #fef2f2;
      color: #7f1d1d;
      font-size: 11px;
      font-weight: 800;
      text-align: center;
      padding: 6px 8px;
      border-radius: 4px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .hint { font-size: 10px; color: #444; margin-top: 6px; }

    @media (max-width: 700px) {
      .page { width: auto; padding: 10px; }
      .who-row, .addr-row, .mid, .veh { grid-template-columns: 1fr; }
      .name { font-size: 20px; }
    }
    @media print {
      @page { size: letter portrait; margin: 0.2in; }
      html, body { background: #fff; }
      .page { width: auto; max-width: none; padding: 0; }
      .who-row { grid-template-columns: ${phone ? "1.35fr 0.85fr" : "1fr"}; }
      .addr-row, .mid { grid-template-columns: 1fr 1fr; }
      .veh { grid-template-columns: 1.1fr 1.6fr 1.6fr 1.7fr; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div>
        <h1 class="company">${esc(AGENCY)}</h1>
        <p class="company-contact">${esc(AGENCY_CONTACT)}</p>
      </div>
      <div class="job-meta">
        <div class="job-badge">${esc(text(data.caseNumber) || "CASE #")}</div>
        <div class="serve-by">SERVE BY: <span class="blank">&nbsp;</span></div>
      </div>
    </div>

    <div class="banner">
      <div class="server-line">${server ? `SERVER: ${esc(server)}` : "&nbsp;"}</div>
      <div class="who-row">
        <div>
          <span class="lab">Party To Serve</span>
          <div class="name">${esc(who) || "&nbsp;"}</div>
        </div>
        ${
          phone
            ? `<div class="phone-box"><span class="lab">Servee Phone / Contact</span><div class="phone-val">${esc(phone)}</div></div>`
            : ""
        }
      </div>
      <div class="addr-row">
        <div class="box">
          <span class="lab">Primary / Home Address</span>
          <div class="val">${esc(text(data.homeAddress)) || "&nbsp;"}</div>
        </div>
        <div class="box">
          <span class="lab">Alt Address / Work</span>
          <div class="val">${esc(text(data.workAddress)) || "&nbsp;"}</div>
        </div>
      </div>
    </div>

    <div class="mid">
      <div class="panel">
        <h3>Case &amp; Legal Information</h3>
        <span class="lab">Case Number &amp; Court</span>
        <div class="val">${esc(caseLine(data)) || "&nbsp;"}</div>
        <span class="lab" style="margin-top:6px;">Documents Included for Service</span>
        <div class="val">${docsHtml(data)}</div>
      </div>
      <div class="panel">
        <h3>Special Directives</h3>
        ${rulesHtml(data)}
        ${extraNotes ? `<div class="notes">${esc(extraNotes)}</div>` : ""}
      </div>
    </div>

    <div class="desc">
      <h3>Servee Physical Description &amp; Vehicle Log</h3>
      <div class="desc-row"><span class="k">Age:</span> □ 18–30 &nbsp; □ 31–45 &nbsp; □ 46–60 &nbsp; □ 60+ &nbsp;&nbsp; <span class="k">Gender:</span> □ Male &nbsp; □ Female</div>
      <div class="desc-row"><span class="k">Height:</span> □ under 5'6" &nbsp; □ 5'6"–5'10" &nbsp; □ 5'11"–6'2" &nbsp; □ 6'3"+</div>
      <div class="desc-row"><span class="k">Weight:</span> □ under 150 &nbsp; □ 150–200 &nbsp; □ 201–250 &nbsp; □ 250+</div>
      <div class="desc-row"><span class="k">Hair:</span> □ Black &nbsp; □ Brown &nbsp; □ Blonde &nbsp; □ Gray &nbsp; □ Bald &nbsp; □ Other: ______</div>
      <div class="veh"><span>Yr</span><span>Make</span><span>Model</span><span>Tag #</span></div>
    </div>

    <div class="log">
      <h3>Service Attempt &amp; Field Notes Log</h3>
      <table>
        <thead>
          <tr>
            <th class="num">#</th>
            <th class="when">Date &amp; Time</th>
            <th>Recipient / Field Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr><td class="num">1</td><td class="when">__/____ @ __:__</td><td></td></tr>
          <tr><td class="num">2</td><td class="when">__/____ @ __:__</td><td></td></tr>
          <tr><td class="num">3</td><td class="when">__/____ @ __:__</td><td></td></tr>
          <tr class="srv"><td class="num">SRV</td><td class="when">__/____ @ __:__</td><td>Served To: __________</td></tr>
        </tbody>
      </table>
    </div>

    <div class="bill">${esc(BILLING_NOTICE)}</div>
    <div class="hint">Generic sheet — same for every user. Flip over if you need more room. Nothing is saved.</div>
  </div>
</body>
</html>`;
}

/** Android Chrome prints the TOP window, not an iframe. Show the sheet on this page, then print. */
export function printFieldSheetInPage(html: string): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  document.getElementById("servetracker-field-sheet-print")?.remove();

  const host = document.createElement("div");
  host.id = "servetracker-field-sheet-print";
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const sheet = parsed.body?.innerHTML || "";
  const styles = Array.from(parsed.head?.querySelectorAll("style") || [])
    .map((s) => s.textContent || "")
    .join("\n");
  host.innerHTML = `<style>${styles}
    #servetracker-field-sheet-print { position: fixed; inset: 0; z-index: 2147483646; background: #fff; overflow: auto; }
    @media print {
      body.printing-field-sheet > *:not(#servetracker-field-sheet-print) { display: none !important; }
      #servetracker-field-sheet-print { position: static; inset: auto; overflow: visible; }
    }
  </style>${sheet}`;
  document.body.appendChild(host);
  document.body.classList.add("printing-field-sheet");

  const cleanup = () => {
    document.body.classList.remove("printing-field-sheet");
    host.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.setTimeout(cleanup, 8000);

  requestAnimationFrame(() => {
    window.focus();
    window.print();
  });
  return true;
}
