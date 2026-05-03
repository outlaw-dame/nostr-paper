import { verifyEvent } from 'nostr-tools/pure';

interface Env {
  BLOSSOM_BUCKET: R2Bucket;
  PUBLIC_BASE_URL?: string;
  MAX_UPLOAD_BYTES?: string;
  ALLOWED_MIME_TYPES?: string;
  FILEBASE_BUCKET?: string;
  FILEBASE_ACCESS_KEY_ID?: string;
  FILEBASE_SECRET_ACCESS_KEY?: string;
  FILEBASE_GATEWAY_BASE_URL?: string;
  FILEBASE_ARCHIVE_MODE?: 'sync' | 'background';
}

interface NostrAuthEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
  nip94: string[][];
  ipfs?: string;
  ipfs_url?: string;
}

interface AuthResult {
  pubkey: string;
  xTags: string[];
}

const HEX_32_PATTERN = /^[0-9a-f]{64}$/;
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const FILEBASE_ENDPOINT = 'https://s3.filebase.com';
const FILEBASE_REGION = 'us-east-1';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Length, X-SHA-256, X-Content-Type, X-Content-Length, Range, *',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      return problem(500, message);
    }
  },
};

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);

  if (url.pathname === '/' && request.method === 'GET') {
    return json({
      name: 'Nostr Paper Blossom Edge',
      supported_buds: ['01', '02', '04', '05', '06', '11', '12'],
      storage: ['cloudflare-r2', ...(isFilebaseConfigured(env) ? ['filebase-ipfs'] : [])],
    });
  }

  if (url.pathname === '/upload') {
    if (request.method === 'HEAD') return handleUploadRequirements(request, env, 'upload');
    if (request.method === 'PUT') return handleUpload(request, env, ctx, 'upload');
  }

  if (url.pathname === '/media') {
    if (request.method === 'HEAD') return handleUploadRequirements(request, env, 'media');
    if (request.method === 'PUT') return handleUpload(request, env, ctx, 'media');
  }

  if (url.pathname === '/mirror' && request.method === 'PUT') {
    return handleMirror(request, env, ctx);
  }

  const listMatch = url.pathname.match(/^\/list\/([0-9a-f]{64})$/i);
  if (listMatch && request.method === 'GET') {
    return handleList(request, env, listMatch[1]!.toLowerCase());
  }

  const blobPath = parseBlobPath(url.pathname);
  if (blobPath) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      return handleGetBlob(request, env, blobPath.sha256);
    }
    if (request.method === 'DELETE') {
      return handleDeleteBlob(request, env, blobPath.sha256);
    }
  }

  return problem(404, 'Not found');
}

async function handleUploadRequirements(
  request: Request,
  env: Env,
  endpoint: 'upload' | 'media',
): Promise<Response> {
  const sha256 = request.headers.get('X-SHA-256')?.trim().toLowerCase();
  const type = request.headers.get('X-Content-Type')?.trim() || 'application/octet-stream';
  const sizeRaw = request.headers.get('X-Content-Length')?.trim();
  const size = sizeRaw ? Number.parseInt(sizeRaw, 10) : NaN;

  if (!sha256 || !HEX_32_PATTERN.test(sha256)) return problem(400, 'Invalid X-SHA-256 header.');
  if (!Number.isSafeInteger(size) || size < 0) return problem(411, 'Missing or invalid X-Content-Length header.');

  const policy = validateUploadPolicy(env, type, size);
  if (!policy.ok) return problem(policy.status, policy.reason);

  const verb = endpoint === 'media' ? 'media' : 'upload';
  const auth = await validateBlossomAuth(request, env, verb, { requiredSha256: sha256 });
  if (auth instanceof Response) return auth;

  return new Response(null, { status: 200, headers: corsHeaders() });
}

async function handleUpload(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  endpoint: 'upload' | 'media',
): Promise<Response> {
  const declaredSha256 = request.headers.get('X-SHA-256')?.trim().toLowerCase();
  if (!declaredSha256 || !HEX_32_PATTERN.test(declaredSha256)) {
    return problem(400, 'X-SHA-256 header is required.');
  }

  const type = normalizeContentType(request.headers.get('Content-Type'));
  const contentLength = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  const policy = validateUploadPolicy(env, type, Number.isFinite(contentLength) ? contentLength : 0);
  if (!policy.ok) return problem(policy.status, policy.reason);

  const verb = endpoint === 'media' ? 'media' : 'upload';
  const auth = await validateBlossomAuth(request, env, verb, { requiredSha256: declaredSha256 });
  if (auth instanceof Response) return auth;

  const body = await request.arrayBuffer();
  const bodyPolicy = validateUploadPolicy(env, type, body.byteLength);
  if (!bodyPolicy.ok) return problem(bodyPolicy.status, bodyPolicy.reason);

  const sha256 = await sha256Hex(body);
  if (sha256 !== declaredSha256) return problem(409, 'X-SHA-256 does not match request body.');

  const existing = await env.BLOSSOM_BUCKET.head(blobKey(sha256));
  const uploaded = existing
    ? uploadedFromMetadata(existing.customMetadata)
    : Math.floor(Date.now() / 1000);

  let filebaseArchive = archiveFromMetadata(existing?.customMetadata);
  if (!existing) {
    await putBlob(env, sha256, body, type, auth.pubkey, uploaded, filebaseArchive);
  }

  const origin = publicOrigin(request, env);
  await putOwnerIndex(env, auth.pubkey, sha256, uploaded, origin);

  if (isFilebaseConfigured(env) && !filebaseArchive) {
    const archiveTask = archiveToFilebase(env, sha256, body, type)
      .then(async (archive) => {
        await putBlob(env, sha256, body, type, auth.pubkey, uploaded, archive);
        await putOwnerIndex(env, auth.pubkey, sha256, uploaded, origin);
        return archive;
      });

    if ((env.FILEBASE_ARCHIVE_MODE ?? 'background') === 'sync') {
      filebaseArchive = await archiveTask;
    } else if (!filebaseArchive) {
      ctx.waitUntil(archiveTask.catch(() => undefined));
    }
  }

  const descriptor = buildDescriptor(request, env, {
    sha256,
    size: body.byteLength,
    type,
    uploaded,
    archive: filebaseArchive,
  });

  return json(descriptor, existing ? 200 : 201);
}

async function handleMirror(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const preAuth = await validateBlossomAuth(request, env, 'upload', { requireXTag: false });
  if (preAuth instanceof Response) return preAuth;

  const payload = await request.json().catch(() => null) as { url?: unknown } | null;
  const sourceUrl = typeof payload?.url === 'string' ? payload.url : '';
  if (!isSafeHttpUrl(sourceUrl)) return problem(400, 'Mirror request body must include an HTTPS url.');

  const upstream = await fetch(sourceUrl, { redirect: 'follow' });
  if (!upstream.ok || !upstream.body) return problem(502, 'Could not fetch mirror source.');

  const type = normalizeContentType(upstream.headers.get('Content-Type'));
  const contentLength = Number.parseInt(upstream.headers.get('Content-Length') ?? '', 10);
  const policy = validateUploadPolicy(env, type, Number.isFinite(contentLength) ? contentLength : 0);
  if (!policy.ok) return problem(policy.status, policy.reason);

  const body = await upstream.arrayBuffer();
  const bodyPolicy = validateUploadPolicy(env, type, body.byteLength);
  if (!bodyPolicy.ok) return problem(bodyPolicy.status, bodyPolicy.reason);

  const sha256 = await sha256Hex(body);
  if (!preAuth.xTags.includes(sha256)) return problem(409, 'Mirrored blob hash does not match authorization x tag.');

  const existing = await env.BLOSSOM_BUCKET.head(blobKey(sha256));
  const uploaded = existing
    ? uploadedFromMetadata(existing.customMetadata)
    : Math.floor(Date.now() / 1000);

  let filebaseArchive = archiveFromMetadata(existing?.customMetadata);
  if (!existing) {
    await putBlob(env, sha256, body, type, preAuth.pubkey, uploaded, filebaseArchive);
  }
  const origin = publicOrigin(request, env);
  await putOwnerIndex(env, preAuth.pubkey, sha256, uploaded, origin);

  if (isFilebaseConfigured(env) && !filebaseArchive) {
    const archiveTask = archiveToFilebase(env, sha256, body, type)
      .then(async (archive) => {
        await putBlob(env, sha256, body, type, preAuth.pubkey, uploaded, archive);
        await putOwnerIndex(env, preAuth.pubkey, sha256, uploaded, origin);
        return archive;
      });

    if ((env.FILEBASE_ARCHIVE_MODE ?? 'background') === 'sync') {
      filebaseArchive = await archiveTask;
    } else if (!filebaseArchive) {
      ctx.waitUntil(archiveTask.catch(() => undefined));
    }
  }

  return json(buildDescriptor(request, env, {
    sha256,
    size: body.byteLength,
    type,
    uploaded,
    archive: filebaseArchive,
  }), existing ? 200 : 201);
}

async function handleGetBlob(request: Request, env: Env, sha256: string): Promise<Response> {
  const head = await env.BLOSSOM_BUCKET.head(blobKey(sha256));
  if (!head) return problem(404, 'Blob not found.');

  const headers = blobHeaders(head);
  const rangeHeader = request.headers.get('Range');
  let status = 200;
  let getOptions: R2GetOptions | undefined;

  if (rangeHeader) {
    const range = parseRange(rangeHeader, head.size);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: corsHeaders({ 'Content-Range': `bytes */${head.size}` }),
      });
    }
    getOptions = { range: range.r2Range };
    status = 206;
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${head.size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
  }

  if (request.method === 'HEAD') {
    return new Response(null, { status, headers });
  }

  const object = await env.BLOSSOM_BUCKET.get(blobKey(sha256), getOptions);
  if (!object?.body) return problem(404, 'Blob not found.');
  return new Response(object.body, { status, headers });
}

async function handleDeleteBlob(request: Request, env: Env, sha256: string): Promise<Response> {
  const auth = await validateBlossomAuth(request, env, 'delete', { requiredSha256: sha256 });
  if (auth instanceof Response) return auth;

  const object = await env.BLOSSOM_BUCKET.head(blobKey(sha256));
  if (!object) return problem(404, 'Blob not found.');

  const owner = object.customMetadata?.owner;
  if (owner && owner !== auth.pubkey) return problem(403, 'Only the uploading pubkey can delete this blob.');

  await env.BLOSSOM_BUCKET.delete(blobKey(sha256));
  await deleteOwnerIndexEntries(env, auth.pubkey, sha256);
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function handleList(request: Request, env: Env, pubkey: string): Promise<Response> {
  if (!PUBKEY_PATTERN.test(pubkey)) return problem(400, 'Invalid pubkey.');

  const authHeader = request.headers.get('Authorization');
  if (authHeader) {
    const auth = await validateBlossomAuth(request, env, 'list', { requireXTag: false });
    if (auth instanceof Response) return auth;
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor')?.toLowerCase() ?? null;
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 1), 1000);
  const since = parseOptionalTimestamp(url.searchParams.get('since'));
  const until = parseOptionalTimestamp(url.searchParams.get('until'));

  const descriptors: BlobDescriptor[] = [];
  let listCursor: string | undefined;
  let pastCursor = cursor === null;

  while (descriptors.length < limit) {
    const listed = await env.BLOSSOM_BUCKET.list({
      prefix: ownerPrefix(pubkey),
      limit: 1000,
      cursor: listCursor,
    });

    for (const object of listed.objects) {
      const sha256 = object.key.split('-').pop()?.replace(/\.json$/, '') ?? '';
      if (!HEX_32_PATTERN.test(sha256)) continue;
      if (!pastCursor) {
        pastCursor = sha256 === cursor;
        continue;
      }

      const indexObject = await env.BLOSSOM_BUCKET.get(object.key);
      const descriptor = await indexObject?.json<BlobDescriptor>().catch(() => null);
      if (!descriptor) continue;
      if (since !== null && descriptor.uploaded < since) continue;
      if (until !== null && descriptor.uploaded > until) continue;

      descriptors.push(descriptor);
      if (descriptors.length >= limit) break;
    }

    if (!listed.truncated || !listed.cursor) break;
    listCursor = listed.cursor;
  }

  return json(descriptors);
}

async function validateBlossomAuth(
  request: Request,
  env: Env,
  verb: string,
  options: { requiredSha256?: string; requireXTag?: boolean } = {},
): Promise<AuthResult | Response> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Nostr ')) return problem(401, 'Missing Blossom authorization.');

  let event: NostrAuthEvent;
  try {
    event = JSON.parse(base64UrlDecode(header.slice('Nostr '.length).trim())) as NostrAuthEvent;
  } catch {
    return problem(401, 'Invalid Blossom authorization encoding.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (event.kind !== 24242) return problem(401, 'Authorization event must be kind 24242.');
  if (!Number.isSafeInteger(event.created_at) || event.created_at > now + 60) {
    return problem(401, 'Authorization created_at is invalid.');
  }
  if (!PUBKEY_PATTERN.test(event.pubkey)) return problem(401, 'Authorization pubkey is invalid.');
  if (!verifyEvent(event as any)) return problem(401, 'Authorization signature is invalid.');

  const tTags = tagValues(event.tags, 't');
  if (!tTags.includes(verb)) return problem(401, `Authorization t tag must be ${verb}.`);

  const expiration = Number.parseInt(tagValues(event.tags, 'expiration')[0] ?? '', 10);
  if (!Number.isSafeInteger(expiration) || expiration <= now) {
    return problem(401, 'Authorization is expired.');
  }

  const allowedServers = tagValues(event.tags, 'server').map((value) => value.toLowerCase());
  if (allowedServers.length > 0) {
    const requestHost = new URL(request.url).hostname.toLowerCase();
    const publicHost = env.PUBLIC_BASE_URL ? new URL(env.PUBLIC_BASE_URL).hostname.toLowerCase() : requestHost;
    if (!allowedServers.includes(requestHost) && !allowedServers.includes(publicHost)) {
      return problem(401, 'Authorization is scoped to a different Blossom server.');
    }
  }

  const xTags = tagValues(event.tags, 'x')
    .map((value) => value.toLowerCase())
    .filter((value) => HEX_32_PATTERN.test(value));
  const xRequired = options.requireXTag ?? options.requiredSha256 !== undefined;
  if (xRequired && xTags.length === 0) return problem(401, 'Authorization is missing an x tag.');
  if (options.requiredSha256 && !xTags.includes(options.requiredSha256)) {
    return problem(401, 'Authorization x tag does not match blob hash.');
  }

  return { pubkey: event.pubkey.toLowerCase(), xTags };
}

function publicOrigin(request: Request, env: Env): string {
  return env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? new URL(request.url).origin;
}

function buildDescriptor(
  request: Request,
  env: Env,
  input: {
    sha256: string;
    size: number;
    type: string;
    uploaded: number;
    archive?: FilebaseArchive;
  },
): BlobDescriptor {
  const origin = publicOrigin(request, env);
  const url = `${origin}/${input.sha256}${extensionForMimeType(input.type)}`;
  const nip94 = [
    ['url', url],
    ['m', input.type],
    ['x', input.sha256],
    ['size', String(input.size)],
    ...(input.archive?.gatewayUrl ? [['fallback', input.archive.gatewayUrl]] : []),
    ['service', input.archive ? 'blossom-r2-filebase' : 'blossom-r2'],
  ];

  return {
    url,
    sha256: input.sha256,
    size: input.size,
    type: input.type,
    uploaded: input.uploaded,
    nip94,
    ...(input.archive?.cid ? { ipfs: input.archive.cid } : {}),
    ...(input.archive?.gatewayUrl ? { ipfs_url: input.archive.gatewayUrl } : {}),
  };
}

async function putBlob(
  env: Env,
  sha256: string,
  body: ArrayBuffer,
  type: string,
  owner: string,
  uploaded: number,
  archive?: FilebaseArchive,
): Promise<void> {
  await env.BLOSSOM_BUCKET.put(blobKey(sha256), body, {
    httpMetadata: {
      contentType: type,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      sha256,
      owner,
      uploaded: String(uploaded),
      type,
      size: String(body.byteLength),
      ...(archive?.cid ? { ipfsCid: archive.cid } : {}),
      ...(archive?.gatewayUrl ? { ipfsUrl: archive.gatewayUrl } : {}),
    },
    sha256,
  });
}

async function putOwnerIndex(
  env: Env,
  pubkey: string,
  sha256: string,
  uploaded: number,
  origin: string,
): Promise<void> {
  const object = await env.BLOSSOM_BUCKET.head(blobKey(sha256));
  if (!object) return;

  const descriptor = buildDescriptor(new Request(origin), env, {
    sha256,
    size: object.size,
    type: object.httpMetadata?.contentType ?? object.customMetadata?.type ?? 'application/octet-stream',
    uploaded,
    archive: archiveFromMetadata(object.customMetadata),
  });

  await env.BLOSSOM_BUCKET.put(ownerIndexKey(pubkey, uploaded, sha256), JSON.stringify(descriptor), {
    httpMetadata: { contentType: 'application/json' },
  });
}

async function deleteOwnerIndexEntries(env: Env, pubkey: string, sha256: string): Promise<void> {
  let cursor: string | undefined;
  const keys: string[] = [];
  do {
    const listed = await env.BLOSSOM_BUCKET.list({ prefix: ownerPrefix(pubkey), cursor });
    keys.push(...listed.objects.map((object) => object.key).filter((key) => key.endsWith(`${sha256}.json`)));
    if (!listed.truncated) break;
    cursor = listed.cursor;
  } while (cursor);

  if (keys.length > 0) await env.BLOSSOM_BUCKET.delete(keys);
}

function blobHeaders(object: R2Object): Headers {
  const headers = corsHeaders({
    'Accept-Ranges': 'bytes',
    'Content-Length': String(object.size),
    'ETag': object.httpEtag,
    'Cache-Control': object.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable',
    'Content-Type': object.httpMetadata?.contentType ?? object.customMetadata?.type ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  if (object.customMetadata?.sha256) headers.set('X-SHA-256', object.customMetadata.sha256);
  if (object.customMetadata?.ipfsCid) headers.set('X-IPFS-CID', object.customMetadata.ipfsCid);
  return headers;
}

function validateUploadPolicy(env: Env, type: string, size: number): { ok: true } | { ok: false; status: number; reason: string } {
  const maxBytes = Number.parseInt(env.MAX_UPLOAD_BYTES ?? '', 10) || DEFAULT_MAX_UPLOAD_BYTES;
  if (size > maxBytes) return { ok: false, status: 413, reason: `File too large. Max allowed size is ${maxBytes} bytes.` };

  const allowed = (env.ALLOWED_MIME_TYPES ?? 'image/*,video/*,audio/*,application/pdf,text/plain,application/octet-stream')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const normalizedType = type.toLowerCase();
  const accepted = allowed.some((rule) => (
    rule.endsWith('/*')
      ? normalizedType.startsWith(rule.slice(0, -1))
      : normalizedType === rule
  ));

  if (!accepted) return { ok: false, status: 415, reason: 'Unsupported media type.' };
  return { ok: true };
}

function parseBlobPath(pathname: string): { sha256: string } | null {
  const match = pathname.match(/^\/([0-9a-f]{64})(?:\.[a-z0-9]+)?$/i);
  return match?.[1] ? { sha256: match[1].toLowerCase() } : null;
}

function parseRange(header: string, size: number): { r2Range: R2Range; start: number; end: number } | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const startRaw = match[1] ?? '';
  const endRaw = match[2] ?? '';
  if (!startRaw && !endRaw) return null;

  if (!startRaw) {
    const suffix = Number.parseInt(endRaw, 10);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return {
      r2Range: { suffix: length },
      start: size - length,
      end: size - 1,
    };
  }

  const start = Number.parseInt(startRaw, 10);
  const requestedEnd = endRaw ? Number.parseInt(endRaw, 10) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) return null;
  if (start < 0 || start >= size || requestedEnd < start) return null;

  const end = Math.min(requestedEnd, size - 1);
  return {
    r2Range: { offset: start, length: end - start + 1 },
    start,
    end,
  };
}

function tagValues(tags: string[][], name: string): string[] {
  return tags
    .filter((tag) => tag[0] === name && typeof tag[1] === 'string')
    .map((tag) => tag[1]!);
}

function parseOptionalTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeContentType(value: string | null): string {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
  return normalized && normalized.includes('/') ? normalized : 'application/octet-stream';
}

function uploadedFromMetadata(metadata: Record<string, string> | undefined): number {
  const uploaded = Number.parseInt(metadata?.uploaded ?? '', 10);
  return Number.isSafeInteger(uploaded) && uploaded > 0 ? uploaded : Math.floor(Date.now() / 1000);
}

function archiveFromMetadata(metadata: Record<string, string> | undefined): FilebaseArchive | undefined {
  if (!metadata?.ipfsCid) return undefined;
  return {
    cid: metadata.ipfsCid,
    ...(metadata.ipfsUrl ? { gatewayUrl: metadata.ipfsUrl } : {}),
  };
}

function blobKey(sha256: string): string {
  return `blobs/${sha256}`;
}

function ownerPrefix(pubkey: string): string {
  return `owners/${pubkey}/`;
}

function ownerIndexKey(pubkey: string, uploaded: number, sha256: string): string {
  const reverseTime = Number.MAX_SAFE_INTEGER - uploaded;
  return `${ownerPrefix(pubkey)}${String(reverseTime).padStart(16, '0')}-${sha256}.json`;
}

function extensionForMimeType(type: string): string {
  switch (type.split(';', 1)[0]?.toLowerCase()) {
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    case 'image/avif': return '.avif';
    case 'video/mp4': return '.mp4';
    case 'video/webm': return '.webm';
    case 'video/quicktime': return '.mov';
    case 'audio/mpeg': return '.mp3';
    case 'audio/mp4': return '.m4a';
    case 'audio/ogg': return '.ogg';
    case 'audio/flac': return '.flac';
    case 'audio/wav': return '.wav';
    case 'application/pdf': return '.pdf';
    case 'text/plain': return '.txt';
    default: return '';
  }
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(padded);
}

function corsHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ ...CORS_HEADERS, ...(extra ?? {}) });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
    }),
  });
}

function problem(status: number, reason: string): Response {
  return new Response(JSON.stringify({ message: reason }), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'X-Reason': reason,
    }),
  });
}

async function sha256Hex(body: ArrayBuffer | string): Promise<string> {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

interface FilebaseArchive {
  cid: string;
  gatewayUrl?: string;
}

function isFilebaseConfigured(env: Env): boolean {
  return Boolean(env.FILEBASE_BUCKET && env.FILEBASE_ACCESS_KEY_ID && env.FILEBASE_SECRET_ACCESS_KEY);
}

async function archiveToFilebase(
  env: Env,
  sha256: string,
  body: ArrayBuffer,
  type: string,
): Promise<FilebaseArchive | undefined> {
  if (!isFilebaseConfigured(env)) return undefined;

  const key = `blossom/${sha256}${extensionForMimeType(type)}`;
  const path = `/${env.FILEBASE_BUCKET}/${key}`;
  const url = `${FILEBASE_ENDPOINT}${path}`;
  const bodyHash = await sha256Hex(body);
  const amzDate = amzDateString(new Date());
  const shortDate = amzDate.slice(0, 8);
  const headers = new Headers({
    'Content-Type': type,
    'X-Amz-Content-Sha256': bodyHash,
    'X-Amz-Date': amzDate,
  });
  const signingHeaders = new Headers(headers);
  signingHeaders.set('Host', 's3.filebase.com');

  const authorization = await signS3Request({
    method: 'PUT',
    canonicalUri: encodeS3Path(path),
    query: '',
    headers: signingHeaders,
    payloadHash: bodyHash,
    accessKeyId: env.FILEBASE_ACCESS_KEY_ID!,
    secretAccessKey: env.FILEBASE_SECRET_ACCESS_KEY!,
    shortDate,
    amzDate,
    region: FILEBASE_REGION,
  });
  headers.set('Authorization', authorization);

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body,
  });

  if (!response.ok) return undefined;

  const cid = response.headers.get('x-amz-meta-cid') ?? undefined;
  if (!cid) return undefined;
  const gatewayBase = (env.FILEBASE_GATEWAY_BASE_URL ?? 'https://ipfs.filebase.io/ipfs').replace(/\/+$/, '');
  return {
    cid,
    gatewayUrl: `${gatewayBase}/${cid}`,
  };
}

interface SignS3RequestInput {
  method: string;
  canonicalUri: string;
  query: string;
  headers: Headers;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  shortDate: string;
  amzDate: string;
  region: string;
}

async function signS3Request(input: SignS3RequestInput): Promise<string> {
  const signedHeaderNames = ['content-type', 'host', 'x-amz-content-sha256', 'x-amz-date'];
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${input.headers.get(name)!.trim()}\n`)
    .join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    input.method,
    input.canonicalUri,
    input.query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const credentialScope = `${input.shortDate}/${input.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    input.amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await getSignatureKey(input.secretAccessKey, input.shortDate, input.region, 's3');
  const signature = await hmacHex(signingKey, stringToSign);

  return [
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');
}

async function getSignatureKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacRaw(`AWS4${secret}`, date);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, 'aws4_request');
}

async function hmacRaw(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function hmacHex(key: ArrayBuffer, data: string): Promise<string> {
  const signature = await hmacRaw(key, data);
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function amzDateString(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodeS3Path(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
