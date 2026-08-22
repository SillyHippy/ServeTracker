import nodemailer from "nodemailer";

const BUSINESS_EMAIL = "info@justlegalsolutions.org";

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  imageData?: string;
  imageUrl?: string;
  /** Only attach binary image when explicitly requested. Default: links-only. */
  attachImage?: boolean;
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.resend.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER || "resend",
      pass: process.env.SMTP_PASSWORD || process.env.RESEND_API_KEY || "",
    },
  });
}

export async function sendEmail(payload: EmailPayload) {
  const { to, subject, html, imageData, imageUrl, attachImage } = payload;
  if (!to || !subject || !html) {
    throw new Error("Missing required fields: to, subject, html");
  }

  // ABSOLUTE SAFETY GUARD: Block any email with test/probe markers or sent during tests
  const isTestContent =
    subject.toLowerCase().includes("probe") ||
    subject.toLowerCase().includes("test attempt") ||
    html.toLowerCase().includes("user-level live mobile probe attempt") ||
    html.toLowerCase().includes("live probe") ||
    html.toLowerCase().includes("probe attempt");

  if (isTestContent) {
    console.warn("[sendEmail] BLOCKED outbound email: matched probe/test safety filter.");
    return { messageId: "blocked_test_email" };
  }

  const recipients = Array.isArray(to) ? [...to] : [to];
  if (!recipients.some((email) => email.toLowerCase() === BUSINESS_EMAIL.toLowerCase())) {
    recipients.push(BUSINESS_EMAIL);
  }

  const attachments: nodemailer.SendMailOptions["attachments"] = [];

  const cid = "serve-evidence";
  let imageInHtml = "";
  let imageBuffer: Buffer | null = null;

  // Links-only by default. Only attach a binary when attachImage === true.
  // (Old clients passed imageUrl/imageData and silently attached Photo 1 only.)
  if (attachImage === true) {
    if (imageUrl && imageUrl.startsWith("http")) {
      try {
        const response = await fetch(imageUrl);
        if (response.ok) {
          imageBuffer = Buffer.from(await response.arrayBuffer());
        }
      } catch (error) {
        console.error("Error downloading image for email:", error);
      }
    } else if (imageUrl && imageUrl.startsWith("/uploads/")) {
      try {
        const filePath = `data${imageUrl}`;
        const absPath = filePath.startsWith("/") ? filePath : `${process.cwd()}/${filePath}`;
        const file = Bun.file(absPath);
        if (await file.exists()) {
          imageBuffer = Buffer.from(await file.arrayBuffer());
        }
      } catch (error) {
        console.error("Error reading local image for email:", error);
      }
    } else if (imageData) {
      let base64Content = imageData;
      if (imageData.includes("base64,")) {
        base64Content = imageData.split("base64,")[1];
      }
      imageBuffer = Buffer.from(base64Content, "base64");
    }

    if (imageBuffer) {
      attachments.push({
        filename: "serve_evidence.jpg",
        content: imageBuffer,
        cid: cid,
      });
      imageInHtml = `<img src="cid:${cid}" style="max-width:100%;height:auto;margin-top:12px;border-radius:6px;" />`;
    }
  }

  const enhancedHtml = html + imageInHtml;

  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_FROM || "no-reply@justlegalsolutions.org",
    replyTo: process.env.EMAIL_REPLY_TO || "info@justlegalsolutions.org",
    to: recipients,
    subject,
    html: enhancedHtml,
    attachments,
  });

  console.log(`[email] Sent to ${recipients.join(", ")} messageId: ${info.messageId} attachments: ${attachments.length}`);

  return {
    success: true,
    message: "Email sent",
    messageId: info.messageId,
    recipients,
  };
}

export async function sendPasswordResetEmail(email: string, resetLink: string, code: string) {
  const html = `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #0f172a; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 1px;">SERVETRACKER</h1>
          <p style="color: #94a3b8; margin: 5px 0 0 0; font-size: 13px;">Just Legal Solutions &bull; Process Serving Platform</p>
        </div>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; padding: 30px; border-radius: 0 0 8px 8px;">
          <h2 style="font-size: 18px; margin-top: 0; color: #0f172a;">Password Reset Request</h2>
          <p style="font-size: 14px;">We received a request to reset your password for your ServeTracker field server account.</p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 24px 0; text-align: center;">
            <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: bold;">Your 6-Digit Verification Code</p>
            <div style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a;">${code}</div>
          </div>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${resetLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; font-size: 14px; font-weight: bold; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password Online</a>
          </div>
          <p style="font-size: 12px; color: #64748b;">This reset code and link will expire in 30 minutes. If you did not request this reset, you can safely ignore this email.</p>
        </div>
      </body>
    </html>
  `;
  try {
    await sendEmail({
      to: email,
      subject: `ServeTracker Password Reset Code: ${code}`,
      html,
    });
    return true;
  } catch (err) {
    console.error("Failed to send password reset email:", err);
    return false;
  }
}

export async function sendAdminNewServerAlert(server: {
  displayName: string;
  username: string;
  email: string;
  phone: string;
  licenseNumber: string;
  licenseJurisdiction: string;
  territory: string[];
  notes: string;
}) {
  const html = `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #0f172a; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 1px;">SERVETRACKER &bull; NEW SERVER ALERT</h1>
          <p style="color: #94a3b8; margin: 5px 0 0 0; font-size: 13px;">Just Legal Solutions Field Server Onboarding</p>
        </div>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
          <h2 style="font-size: 18px; margin-top: 0; color: #0f172a;">🎉 New Field Server Onboarded!</h2>
          <p style="font-size: 14px;"><strong>${server.displayName}</strong> (@${server.username}) has just self-enrolled on ServeTracker.</p>
          
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 16px 0; font-size: 13px;">
            <p style="margin: 4px 0;"><strong>Phone:</strong> ${server.phone || 'Not provided'}</p>
            <p style="margin: 4px 0;"><strong>Email:</strong> ${server.email || 'Not provided'}</p>
            <p style="margin: 4px 0;"><strong>PSL License:</strong> ${server.licenseNumber || 'None'} (${server.licenseJurisdiction || 'N/A'})</p>
            <p style="margin: 4px 0;"><strong>Territory:</strong> ${server.territory.join(', ') || 'General'}</p>
            ${server.notes ? `<p style="margin: 4px 0;"><strong>Rates & Notes:</strong> ${server.notes}</p>` : ''}
          </div>

          <div style="text-align: center; margin: 24px 0;">
            <a href="https://servetracker.justlegalsolutions.org/servers" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; font-size: 14px; font-weight: bold; text-decoration: none; border-radius: 6px; display: inline-block;">View in Field Servers</a>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    await sendEmail({
      to: ["info@justlegalsolutions.org", "Joseph@justlegalsolutions.org"],
      subject: `🔔 New Field Server Enrolled: ${server.displayName} (${server.territory.join(', ') || 'Oklahoma'})`,
      html,
    });
    return true;
  } catch (err) {
    console.error("Failed to send admin new server alert:", err);
    return false;
  }
}

export async function sendWelcomeOnboardingEmail(email: string, displayName: string, username: string) {
  if (!email || !email.includes("@")) return false;
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 16px; background-color: #f1f5f9;">
        <div style="background-color: #0f172a; padding: 24px 20px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ffffff; margin: 0; font-size: 22px; letter-spacing: 1.5px; font-weight: 800;">SERVETRACKER</h1>
          <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 13px;">Just Legal Solutions &bull; Process Serving Platform</p>
        </div>
        
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; padding: 28px 24px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <h2 style="font-size: 18px; margin-top: 0; color: #0f172a;">Welcome to the Team, ${displayName}!</h2>
          <p style="font-size: 14px; color: #334155;">Your field process server account is active. You can now receive job dispatches, log attempts offline, and 1-click execute court-ready affidavits.</p>
          
          <!-- Account Summary -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin: 20px 0;">
            <div style="font-size: 12px; color: #64748b; font-weight: bold; text-transform: uppercase; margin-bottom: 6px;">Your Login Details</div>
            <div style="font-size: 14px; color: #0f172a;"><strong>Username:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${username}</code></div>
            <div style="font-size: 14px; color: #0f172a; margin-top: 4px;"><strong>Portal URL:</strong> <a href="https://servetracker.justlegalsolutions.org/login" style="color: #2563eb; text-decoration: none;">servetracker.justlegalsolutions.org</a></div>
          </div>

          <!-- PWA Installation Guide -->
          <div style="border-top: 2px dashed #e2e8f0; padding-top: 20px; margin-top: 24px;">
            <h3 style="font-size: 16px; margin: 0 0 12px 0; color: #0f172a;">
              📲 How to Install the App on Your Phone (PWA)
            </h3>
            <p style="font-size: 13px; color: #475569; margin: 0 0 16px 0;">ServeTracker runs like a native app on your phone with offline GPS logging and camera support.</p>
            
            <!-- iOS Instructions -->
            <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 14px; margin-bottom: 14px;">
              <strong style="color: #0369a1; font-size: 14px;">📱 iPhone / iPad (Safari):</strong>
              <ol style="font-size: 13px; color: #0c4a6e; margin: 8px 0 0 0; padding-left: 20px; line-height: 1.5;">
                <li>Open <a href="https://servetracker.justlegalsolutions.org" style="color: #0284c7; font-weight: bold;">servetracker.justlegalsolutions.org</a> in <strong>Safari</strong>.</li>
                <li>Tap the <strong>Share</strong> button (the square icon with an arrow pointing up at the bottom).</li>
                <li>Scroll down and tap <strong>"Add to Home Screen"</strong>.</li>
                <li>Tap <strong>"Add"</strong> in the top-right corner.</li>
              </ol>
            </div>

            <!-- Android Instructions -->
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin-bottom: 14px;">
              <strong style="color: #15803d; font-size: 14px;">🤖 Android / Samsung (Chrome):</strong>
              <ol style="font-size: 13px; color: #14532d; margin: 8px 0 0 0; padding-left: 20px; line-height: 1.5;">
                <li>Open <a href="https://servetracker.justlegalsolutions.org" style="color: #16a34a; font-weight: bold;">servetracker.justlegalsolutions.org</a> in <strong>Chrome</strong>.</li>
                <li>Tap the <strong>three dots (⋮)</strong> menu in the top-right corner.</li>
                <li>Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.</li>
              </ol>
            </div>
          </div>

          <!-- Notification Instructions -->
          <div style="background: #fefce8; border: 1px solid #fef08a; border-radius: 8px; padding: 14px; margin-top: 16px;">
            <strong style="color: #a16207; font-size: 14px;">🔔 Important: Enable Instant Notifications</strong>
            <p style="font-size: 13px; color: #713f12; margin: 6px 0 0 0;">
              Once installed, open the app from your home screen and tap the <strong>Notification Bell (🔔)</strong> at the top. Tap <strong>"Allow"</strong> when prompted so you receive instant alerts whenever new papers or urgent server directives are assigned to you.
            </p>
          </div>

          <!-- Action Button -->
          <div style="text-align: center; margin: 28px 0 10px 0;">
            <a href="https://servetracker.justlegalsolutions.org/login" style="background-color: #2563eb; color: #ffffff; padding: 13px 28px; font-size: 15px; font-weight: bold; text-decoration: none; border-radius: 8px; display: inline-block;">Launch ServeTracker</a>
          </div>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px; text-align: center; font-size: 12px; color: #94a3b8;">
            Questions or dispatch help? Contact Just Legal Solutions at (539) 367-6832 or info@justlegalsolutions.org
          </div>
        </div>
      </body>
    </html>
  `;
  try {
    await sendEmail({
      to: email,
      subject: `Welcome to ServeTracker: Account Confirmation & App Setup`,
      html,
    });
    return true;
  } catch (err) {
    console.error("Failed to send welcome onboarding email:", err);
    return false;
  }
}
