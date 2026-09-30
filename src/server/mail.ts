import "server-only";
import { env } from "@/lib/env";

/**
 * Outgoing mail, which Bothy sends only when SMTP_URL is set and only for one
 * thing so far: a password reset link. Loaded lazily so the mail library never
 * reaches a bundle that will not send anything.
 */

export const mailConfigured = Boolean(env.SMTP_URL && env.MAIL_FROM);

export async function sendMail(message: { to: string; subject: string; text: string }): Promise<void> {
  if (!env.SMTP_URL || !env.MAIL_FROM) throw new Error("Mail is not configured");
  const { createTransport } = await import("nodemailer");
  const transport = createTransport(env.SMTP_URL);
  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}
