// Transactional email via Resend — the one provider already wired for embed
// notifications (embed-track.ts). Best-effort by contract: returns true only on
// a 2xx send, false on anything else, and NEVER throws. A failed email must not
// fail its caller (e.g. a paid-order webhook whose tenant is already provisioned:
// the operator alert is the fallback, not a 500).
interface SendArgs {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  from?: string;
}

export async function sendEmail({ to, subject, text, replyTo, from }: SendArgs): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const sender =
    from ||
    process.env.WELCOME_EMAIL_FROM ||
    process.env.ALERT_EMAIL_FROM ||
    "WARPCHART <hello@warpchart.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender, to, subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
