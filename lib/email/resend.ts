import { Resend } from "resend";
import { getServerEnv } from "../env";

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

function getResendClient() {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) return null;
  return new Resend(env.RESEND_API_KEY);
}

async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  const client = getResendClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY missing, email not sent", { to, subject });
    return;
  }

  const { error } = await client.emails.send({
    from: "Wein-Ticker <onboarding@resend.dev>",
    to,
    subject,
    html
  });

  if (error) {
    throw new Error(`Resend email failed: ${error.message}`);
  }
}

export async function sendVerificationEmail(input: {
  to: string;
  verifyUrl: string;
  wineName: string;
}): Promise<void> {
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      <h2>Bitte E-Mail bestaetigen</h2>
      <p>Du hast Wein-Ticker fuer <strong>${input.wineName}</strong> aktiviert.</p>
      <p>Klicke auf den Link, um deine Benachrichtigung zu bestaetigen:</p>
      <p><a href="${input.verifyUrl}">${input.verifyUrl}</a></p>
      <p>Falls du das nicht warst, ignoriere diese E-Mail.</p>
    </div>
  `;

  await sendEmail({
    to: input.to,
    subject: "Bitte bestaetige deine Wein-Ticker Anmeldung",
    html
  });
}

export async function sendTrackingReadyEmail(input: {
  to: string;
  trackingUrl: string;
}): Promise<void> {
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      <h2>Tracking aktiv</h2>
      <p>Deine Wein-Benachrichtigungen sind jetzt aktiv.</p>
      <p>Deine Uebersicht findest du hier:</p>
      <p><a href="${input.trackingUrl}">${input.trackingUrl}</a></p>
    </div>
  `;

  await sendEmail({
    to: input.to,
    subject: "Dein Wein-Ticker Tracking ist aktiv",
    html
  });
}

export async function sendSaleAlertEmail(input: {
  to: string;
  wineName: string;
  currentPrice: number;
  basePrice: number | null;
  trackingUrl: string;
}): Promise<void> {
  const priceText =
    input.basePrice != null
      ? `Jetzt CHF ${input.currentPrice.toFixed(2)} statt CHF ${input.basePrice.toFixed(2)}`
      : `Jetzt CHF ${input.currentPrice.toFixed(2)}`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      <h2>${input.wineName} ist im Angebot</h2>
      <p>${priceText}</p>
      <p>Deine Trackings verwalten:</p>
      <p><a href="${input.trackingUrl}">${input.trackingUrl}</a></p>
    </div>
  `;

  await sendEmail({
    to: input.to,
    subject: `Jetzt im Angebot: ${input.wineName}`,
    html
  });
}
