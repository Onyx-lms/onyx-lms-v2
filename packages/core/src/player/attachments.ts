/**
 * PL-08 -- lesson attachments.
 *
 * A course file is not public: handing out a permanent storage URL means anyone
 * with the link keeps access forever, enrolled or not. Attachments are served
 * as short-lived signed URLs, minted only after the same access check the
 * lesson itself passes.
 */
import { StorageService } from '../storage/storage.service.ts';

export const ATTACHMENT_TTL_SECONDS = 300;

export interface ResolvedAttachment {
  url: string | null;
  file_name: string;
  attachment_type: string | null;
  expires_in: number;
}

export async function resolveAttachment(
  storage: StorageService,
  attachment: string | null | undefined,
  attachmentType: string | null | undefined,
): Promise<ResolvedAttachment | null> {
  if (!attachment) return null;
  const key = StorageService.toKey(attachment);
  return {
    url: await storage.signedUrl(attachment, ATTACHMENT_TTL_SECONDS),
    file_name: key.split('/').pop() ?? key,
    attachment_type: attachmentType ?? null,
    expires_in: ATTACHMENT_TTL_SECONDS,
  };
}
