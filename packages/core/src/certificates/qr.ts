/**
 * CERT-04 -- the verification QR code.
 *
 * Rendered as an inline SVG data URI so the certificate page stays entirely
 * self-contained: no external image request, and it survives being printed or
 * saved to PDF.
 */
import QRCode from 'qrcode';

export async function verificationQrDataUri(verifyUrl: string, size = 150): Promise<string> {
  const svg = await QRCode.toString(verifyUrl, {
    type: 'svg', margin: 1, width: size,
    color: { dark: '#000000', light: '#ffffff' },
  });
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

export function verificationUrl(webOrigin: string, identifier: string): string {
  return webOrigin.replace(/\/+$/, '') + '/verify/certificate/' + encodeURIComponent(identifier);
}
