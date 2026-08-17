/**
 * P-06 -- email bodies.
 *
 * Plain inlined HTML on purpose: mail clients strip <style> blocks and have no
 * CSS cascade worth relying on. Kept close to Laravel's notification wording so
 * users see the same messages after the cutover.
 */
export interface BrandContext {
  siteTitle: string;
  actionUrl: string;
}

function shell(siteTitle: string, heading: string, body: string, cta?: { url: string; label: string }) {
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">',
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(siteTitle)}</h1>`,
    `<h2 style="font-size:16px;margin:0 0 12px">${escapeHtml(heading)}</h2>`,
    `<p style="font-size:14px;line-height:1.6;margin:0 0 20px">${body}</p>`,
    cta
      ? `<p style="margin:0 0 24px"><a href="${cta.url}" style="background:#2b57c4;color:#fff;` +
        `padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;display:inline-block">` +
        `${escapeHtml(cta.label)}</a></p>` +
        `<p style="font-size:12px;color:#6b7280;margin:0 0 8px">If the button does not work, paste this into your browser:</p>` +
        `<p style="font-size:12px;color:#6b7280;word-break:break-all;margin:0">${cta.url}</p>`
      : '',
    '</div>',
  ].join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

export function verifyEmailTemplate(ctx: BrandContext) {
  return {
    subject: `Verify your email address`,
    html: shell(ctx.siteTitle, 'Confirm your email',
      'Please confirm your email address to finish setting up your account. This link expires in 60 minutes.',
      { url: ctx.actionUrl, label: 'Verify email address' }),
  };
}

export function resetPasswordTemplate(ctx: BrandContext) {
  return {
    subject: 'Reset your password',
    html: shell(ctx.siteTitle, 'Reset your password',
      'We received a request to reset your password. This link expires in 60 minutes. ' +
      'If you did not make this request, you can safely ignore this email.',
      { url: ctx.actionUrl, label: 'Reset password' }),
  };
}

export function contactReplyTemplate(siteTitle: string, body: string) {
  return {
    subject: `Re: your message to ${siteTitle}`,
    html: shell(siteTitle, 'Thanks for getting in touch', escapeHtml(body)),
  };
}
