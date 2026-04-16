import { verifyEvent } from 'nostr-tools/pure';
import { z } from 'zod';

const TagSchema = z.tuple([z.string(), z.string().optional(), z.string().optional(), z.string().optional()]);

export const NostrEventSchema = z.object({
  id: z.string().length(64),
  pubkey: z.string().length(64),
  kind: z.number().int(),
  created_at: z.number().int(),
  tags: z.array(TagSchema),
  content: z.string(),
  sig: z.string().length(128)
});

export type NostrEvent = z.infer<typeof NostrEventSchema>;

export function validateAndVerifyEvent(event: unknown, limits: { maxBytes: number; maxTags: number }) {
  const parsed = NostrEventSchema.safeParse(event);
  if (!parsed.success) {
    return { ok: false as const, reason: 'schema_invalid' };
  }

  const e = parsed.data;

  // Size limits
  const byteLen = Buffer.byteLength(e.content ?? '', 'utf8');
  if (byteLen > limits.maxBytes) {
    return { ok: false as const, reason: 'content_too_large' };
  }

  if (e.tags.length > limits.maxTags) {
    return { ok: false as const, reason: 'too_many_tags' };
  }

  // Signature verification (defense in depth)
  try {
    const valid = verifyEvent(e as any);
    if (!valid) {
      return { ok: false as const, reason: 'signature_invalid' };
    }
  } catch {
    return { ok: false as const, reason: 'signature_error' };
  }

  return { ok: true as const, event: e };
}
