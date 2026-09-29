/**
 * Tenant-scoped HTTP email sender with 3-provider API cascade:
 * Resend (100/day) -> Brevo (300/day) -> Mailjet (200/day)
 * Pure HTTP REST calls over HTTPS (no SMTP port 25/587 connection requirements).
 */

export interface TenantEmailConfig {
  resendApiKey?: string;
  resendFromEmail?: string;
  brevoApiKey?: string;
  brevoFromEmail?: string;
  mailjetApiKey?: string;
  mailjetSecretKey?: string;
  mailjetFromEmail?: string;
  companyName?: string;
  replyToEmail?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  config?: TenantEmailConfig | null;
}

export interface SendResult {
  success: boolean;
  provider: "resend" | "brevo" | "mailjet" | "mock" | "system";
  messageId?: string;
  error?: string;
  attempts?: Array<{ provider: string; error: string }>;
}

/** Send email via Resend REST API */
export async function sendViaResend(
  apiKey: string,
  fromEmail: string,
  to: string[],
  subject: string,
  html: string,
  companyName?: string
): Promise<{ messageId: string }> {
  const fromFormatted = companyName ? `${companyName} <${fromEmail}>` : fromEmail;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromFormatted,
      to,
      subject,
      html,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body?.message as string) || (body?.error as string) || `Resend error HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { messageId: String(body.id || "resend_ok") };
}

/** Send email via Brevo REST API v3 */
export async function sendViaBrevo(
  apiKey: string,
  fromEmail: string,
  to: string[],
  subject: string,
  html: string,
  companyName?: string
): Promise<{ messageId: string }> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: fromEmail,
        name: companyName || "Process Server Notification",
      },
      to: to.map((email) => ({ email })),
      subject,
      htmlContent: html,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body?.message as string) || `Brevo error HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { messageId: String(body.messageId || "brevo_ok") };
}

/** Send email via Mailjet REST API v3.1 */
export async function sendViaMailjet(
  apiKey: string,
  secretKey: string,
  fromEmail: string,
  to: string[],
  subject: string,
  html: string,
  companyName?: string
): Promise<{ messageId: string }> {
  const authHeader = "Basic " + Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
  const res = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Messages: [
        {
          From: {
            Email: fromEmail,
            Name: companyName || "Process Server Notification",
          },
          To: to.map((email) => ({ Email: email })),
          Subject: subject,
          HTMLPart: html,
        },
      ],
    }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body?.ErrorMessage as string) || `Mailjet error HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { messageId: "mailjet_ok" };
}

/**
 * Execute cascading email dispatch:
 * 1. Resend (if configured)
 * 2. Brevo (if configured, or if Resend fails)
 * 3. Mailjet (if configured, or if Brevo fails)
 * 4. System / mock fallback
 */
export async function sendWithCascade(opts: SendEmailOptions): Promise<SendResult> {
  const { to, subject, html, config } = opts;
  const toList = Array.isArray(to) ? to : [to];
  const attempts: Array<{ provider: string; error: string }> = [];

  // Safety / mock gate
  if (process.env.DISABLE_EMAIL === "true" || process.env.MOCK_EMAIL === "true" || process.env.NODE_ENV === "test") {
    return { success: true, provider: "mock", messageId: "mock_email_ok" };
  }

  // 1. Try Resend
  if (config?.resendApiKey) {
    const from = config.resendFromEmail || "notifications@resend.dev";
    try {
      const res = await sendViaResend(config.resendApiKey, from, toList, subject, html, config.companyName);
      return { success: true, provider: "resend", messageId: res.messageId, attempts };
    } catch (err: unknown) {
      attempts.push({ provider: "resend", error: (err instanceof Error && err.message) || String(err) });
      console.warn(`[tenantEmail] Resend failed, falling back to next provider:`, (err instanceof Error && err.message) || String(err));
    }
  }

  // 2. Try Brevo
  if (config?.brevoApiKey) {
    const from = config.brevoFromEmail || config.resendFromEmail || "notifications@brevo.com";
    try {
      const res = await sendViaBrevo(config.brevoApiKey, from, toList, subject, html, config.companyName);
      return { success: true, provider: "brevo", messageId: res.messageId, attempts };
    } catch (err: unknown) {
      attempts.push({ provider: "brevo", error: (err instanceof Error && err.message) || String(err) });
      console.warn(`[tenantEmail] Brevo failed, falling back to next provider:`, (err instanceof Error && err.message) || String(err));
    }
  }

  // 3. Try Mailjet
  if (config?.mailjetApiKey && config?.mailjetSecretKey) {
    const from = config.mailjetFromEmail || config.brevoFromEmail || config.resendFromEmail || "notifications@mailjet.com";
    try {
      const res = await sendViaMailjet(
        config.mailjetApiKey,
        config.mailjetSecretKey,
        from,
        toList,
        subject,
        html,
        config.companyName
      );
      return { success: true, provider: "mailjet", messageId: res.messageId, attempts };
    } catch (err: unknown) {
      attempts.push({ provider: "mailjet", error: (err instanceof Error && err.message) || String(err) });
      console.warn(`[tenantEmail] Mailjet failed:`, (err instanceof Error && err.message) || String(err));
    }
  }

  // 4. System / environment fallback if no tenant provider succeeded or none configured
  if (process.env.RESEND_API_KEY) {
    try {
      const sysFrom = process.env.SYSTEM_FROM_EMAIL || "info@justlegalsolutions.org";
      const res = await sendViaResend(process.env.RESEND_API_KEY, sysFrom, toList, subject, html, config?.companyName);
      return { success: true, provider: "system", messageId: res.messageId, attempts };
    } catch (err: unknown) {
      attempts.push({ provider: "system", error: (err instanceof Error && err.message) || String(err) });
    }
  }

  return {
    success: false,
    provider: "system",
    error: attempts.map((a) => `${a.provider}: ${a.error}`).join("; ") || "No email providers configured",
    attempts,
  };
}
