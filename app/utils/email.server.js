import { Resend } from "resend";

// Where support messages are delivered.
export const SUPPORT_TO = "haideraliminhas77@gmail.com";

// Resend requires a verified "from" address. Until a custom domain is verified,
// Resend's shared onboarding sender works for testing. Override with
// SUPPORT_FROM once your own domain is verified in Resend.
const SUPPORT_FROM =
  process.env.SUPPORT_FROM || "Smart Activity Tracker <onboarding@resend.dev>";

/**
 * Send a support/contact message. Returns { ok } or { ok:false, error }.
 * Never throws — the caller renders a friendly result either way.
 */
export async function sendSupportEmail({ name, email, message, shop }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set — cannot send support email");
    return { ok: false, error: "Email is not configured. Please try later." };
  }

  const resend = new Resend(apiKey);

  const text = [
    `New support message from ${name}`,
    ``,
    `Name:  ${name}`,
    `Email: ${email}`,
    `Shop:  ${shop}`,
    ``,
    `Message:`,
    message,
  ].join("\n");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#202223">
      <h2 style="margin:0 0 12px">New support message</h2>
      <p style="margin:0 0 4px"><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p style="margin:0 0 4px"><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p style="margin:0 0 12px"><strong>Shop:</strong> ${escapeHtml(shop)}</p>
      <p style="margin:0 0 4px"><strong>Message:</strong></p>
      <p style="white-space:pre-wrap;margin:0">${escapeHtml(message)}</p>
    </div>`;

  try {
    const { error } = await resend.emails.send({
      from: SUPPORT_FROM,
      to: SUPPORT_TO,
      replyTo: email,
      subject: `Support: ${name} (${shop})`,
      text,
      html,
    });
    if (error) {
      console.error("Resend send error", error);
      return { ok: false, error: "Couldn't send your message. Please try again." };
    }
    return { ok: true };
  } catch (err) {
    console.error("sendSupportEmail failed", err);
    return { ok: false, error: "Couldn't send your message. Please try again." };
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
