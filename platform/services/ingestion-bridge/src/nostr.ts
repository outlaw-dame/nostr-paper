import { verifyEvent } from 'nostr-tools/pure';
import { z } from 'zod';

const TagSchema = z.array(z.string());

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

export interface NostrRelayListSnapshot {
  read_relays: string[];
  write_relays: string[];
}

function isValidRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' || url.protocol === 'ws:';
  } catch {
    return false;
  }
}

function dedupeRelayUrls(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!isValidRelayUrl(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function parseKind10002RelayList(tags: string[][]): NostrRelayListSnapshot {
  const readRelays: string[] = [];
  const writeRelays: string[] = [];

  for (const tag of tags) {
    const [name, relayUrl, marker] = tag;
    if (name !== 'r' || !relayUrl || !isValidRelayUrl(relayUrl)) continue;

    if (!marker || marker === 'read') {
      readRelays.push(relayUrl);
    }
    if (!marker || marker === 'write') {
      writeRelays.push(relayUrl);
    }
  }

  return {
    read_relays: dedupeRelayUrls(readRelays),
    write_relays: dedupeRelayUrls(writeRelays),
  };
}

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
