export type NostrTag = string[];

export const MEDIA_KINDS = new Set([21, 22, 1063, 34235, 34236]);
export const BLOSSOM_SERVER_LIST_KIND = 10063;
export const BLOSSOM_RELAY_KINDS = new Set([...MEDIA_KINDS, BLOSSOM_SERVER_LIST_KIND]);

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function normalizeIndexText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractUrls(content: string): string[] {
  const matches = content.match(/https?:\/\/[^\s]+/g);
  return matches ?? [];
}

function extractImetaValue(parts: string[], key: string): string | null {
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.toLowerCase().startsWith(`${key} `)) continue;
    const value = trimmed.slice(key.length + 1).trim();
    if (!value) continue;
    return value;
  }
  return null;
}

export function extractMediaText(tags: NostrTag[]): string[] {
  const values = new Set<string>();

  for (const tag of tags) {
    const [name, firstValue] = tag;
    if (typeof firstValue !== 'string' || firstValue.trim().length === 0) continue;

    if (name === 'title' || name === 'alt' || name === 'summary' || name === 'm') {
      const normalized = normalizeIndexText(firstValue);
      if (normalized) values.add(normalized);
      continue;
    }

    if (name === 'x' && /^[0-9a-f]{64}$/i.test(firstValue)) {
      values.add(firstValue.toLowerCase());
      continue;
    }

    if (name === 'imeta') {
      const imetaParts = tag.slice(1).filter((part): part is string => typeof part === 'string');
      const alt = extractImetaValue(imetaParts, 'alt');
      const summary = extractImetaValue(imetaParts, 'summary');
      const mime = extractImetaValue(imetaParts, 'm');

      if (alt) values.add(normalizeIndexText(alt));
      if (summary) values.add(normalizeIndexText(summary));
      if (mime) values.add(normalizeIndexText(mime));
    }
  }

  return [...values].filter((value) => value.length > 0);
}

export function extractTaggedUrls(tags: NostrTag[]): string[] {
  const urls = new Set<string>();

  for (const tag of tags) {
    const [name, firstValue] = tag;
    if (typeof firstValue !== 'string') continue;

    if ((name === 'url' || name === 'r' || name === 'fallback' || name === 'server') && isHttpUrl(firstValue)) {
      urls.add(firstValue);
      continue;
    }

    if (name !== 'imeta') continue;
    const imetaParts = tag.slice(1).filter((part): part is string => typeof part === 'string');
    const primaryUrl = extractImetaValue(imetaParts, 'url');
    const thumbUrl = extractImetaValue(imetaParts, 'thumb');
    const imageUrl = extractImetaValue(imetaParts, 'image');

    if (primaryUrl && isHttpUrl(primaryUrl)) urls.add(primaryUrl);
    if (thumbUrl && isHttpUrl(thumbUrl)) urls.add(thumbUrl);
    if (imageUrl && isHttpUrl(imageUrl)) urls.add(imageUrl);
  }

  return [...urls];
}

export function mergeEventUrls(content: string, tags: NostrTag[]): string[] {
  return [...new Set([...extractUrls(content), ...extractTaggedUrls(tags)])];
}

export function buildEventSearchText(input: {
  title: string | null;
  content: string;
  hashtags: string[];
  tags: NostrTag[];
  kind: number;
}): string {
  const textParts: string[] = [];
  if (input.title) textParts.push(input.title);
  if (input.content) textParts.push(input.content);
  if (BLOSSOM_RELAY_KINDS.has(input.kind)) {
    textParts.push(...extractMediaText(input.tags));
  }
  input.hashtags.forEach((hashtag) => textParts.push(`#${hashtag}`));

  return [...new Set(textParts.map(normalizeIndexText).filter(Boolean))].join(' ').trim();
}
