import nodemailer from 'nodemailer';
import { env } from './env.js';

const transport = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;

export const emailEnabled = Boolean(transport);

/** Sends an email if SMTP is configured. Returns false (never throws) when it couldn't. */
export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  if (!transport) return false;
  try {
    await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text, html });
    return true;
  } catch (err) {
    console.error('Email send failed:', (err as Error).message);
    return false;
  }
}
