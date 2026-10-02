import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { phMobile } from './members.util';

export interface SendResult { status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED'; error?: string }

/** One place that sends email (the company email: MAIL_FROM through SMTP_URL) and SMS (Semaphore) for the campaigns. */
@Injectable()
export class MessagingService {
  config() { return { emailConfigured: !!process.env.SMTP_URL, from: process.env.MAIL_FROM || null, smsConfigured: !!process.env.SEMAPHORE_API_KEY, smsSender: process.env.SEMAPHORE_SENDER || null }; }

  async email(to: string, subject: string, text: string, html?: string, unsubscribeUrl?: string): Promise<SendResult> {
    if (!/^\S+@\S+\.\S+$/.test(to)) return { status: 'FAILED', error: 'Not a valid email address' };
    if (!process.env.SMTP_URL) return { status: 'NOT_CONFIGURED', error: 'Email is not set up (SMTP_URL and MAIL_FROM in api/.env)' };
    try {
      await nodemailer.createTransport(process.env.SMTP_URL).sendMail({ from: process.env.MAIL_FROM || 'noreply@gws.local', to, subject, text, html, ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } } : {}) });
      return { status: 'SENT' };
    } catch (e) { return { status: 'FAILED', error: (e as Error).message }; }
  }

  async sms(to: string, message: string): Promise<SendResult> {
    const num = phMobile(to); if (!num) return { status: 'FAILED', error: 'Not a valid PH mobile number' };
    const key = process.env.SEMAPHORE_API_KEY; if (!key) return { status: 'NOT_CONFIGURED', error: 'SMS is not set up (SEMAPHORE_API_KEY in api/.env)' };
    try {
      const res = await fetch('https://api.semaphore.co/api/v4/messages', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ apikey: key, number: num, message, ...(process.env.SEMAPHORE_SENDER ? { sendername: process.env.SEMAPHORE_SENDER } : {}) }) });
      return res.ok ? { status: 'SENT' } : { status: 'FAILED', error: `SMS provider answered ${res.status}` };
    } catch (e) { return { status: 'FAILED', error: (e as Error).message }; }
  }
}
