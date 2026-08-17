/**
 * P-06 -- transactional mail.
 *
 * SMTP credentials live in the `settings` table, exactly as Laravel's Mailer
 * read them (protocol, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_crypto,
 * smtp_from_email). Nothing is read from the environment, so an administrator
 * changing SMTP in the admin panel takes effect without a redeploy.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import type { SettingsService } from '../settings/settings.service.ts';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface MailResult {
  sent: boolean;
  skipped?: 'not-configured';
  messageId?: string;
  error?: string;
}

export class MailService {
  #settings: SettingsService;
  #transport: Transporter | null = null;
  #signature = '';

  constructor(settings: SettingsService) { this.#settings = settings; }

  /** Rebuilds the transport when SMTP settings change. */
  async #transporter(): Promise<{ transport: Transporter; from: string } | null> {
    const [host, port, user, pass, crypto, from, protocol] = await Promise.all([
      this.#settings.get('smtp_host'), this.#settings.get('smtp_port'),
      this.#settings.get('smtp_user'), this.#settings.get('smtp_pass'),
      this.#settings.get('smtp_crypto'), this.#settings.get('smtp_from_email'),
      this.#settings.get('protocol'),
    ]);

    if (protocol !== 'smtp' || !host || !port) return null;

    const signature = [host, port, user, pass, crypto].join('|');
    if (!this.#transport || signature !== this.#signature) {
      this.#transport = nodemailer.createTransport({
        host,
        port: Number(port),
        // Port 465 is implicit TLS; everything else upgrades via STARTTLS.
        secure: Number(port) === 465 || crypto === 'ssl',
        auth: user ? { user, pass: pass ?? '' } : undefined,
        // Local relays (mailpit, mailhog) present self-signed certs.
        tls: { rejectUnauthorized: false },
      });
      this.#signature = signature;
    }
    return { transport: this.#transport, from: from || 'no-reply@localhost' };
  }

  /**
   * Never throws. A dead mail server must not roll back a completed
   * registration -- the account exists, the link can be resent.
   */
  async send(message: MailMessage): Promise<MailResult> {
    const configured = await this.#transporter();
    if (!configured) return { sent: false, skipped: 'not-configured' };
    try {
      const info = await configured.transport.sendMail({
        from: configured.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text ?? stripHtml(message.html),
      });
      return { sent: true, messageId: info.messageId };
    } catch (e) {
      return { sent: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  invalidate(): void { this.#transport = null; this.#signature = ''; }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
