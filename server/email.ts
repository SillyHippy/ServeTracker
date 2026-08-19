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
