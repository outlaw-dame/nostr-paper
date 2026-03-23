/**
 * Blossom — SHA-256 Hashing
 *
 * Uses the Web Crypto API (SubtleCrypto) for spec-compliant, hardware-
 * accelerated SHA-256 computation entirely client-side with no dependencies.
 */

/** Convert an ArrayBuffer to lowercase hex string */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Compute SHA-256 of a File or Blob. Returns lowercase hex string. */
export async function sha256File(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return bufferToHex(digest)
}

/** Compute SHA-256 of an ArrayBuffer. Returns lowercase hex string. */
export async function sha256Buffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return bufferToHex(digest)
}

/** Compute SHA-256 of a UTF-8 string. Returns lowercase hex string. */
export async function sha256String(text: string): Promise<string> {
  const buffer = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return bufferToHex(digest)
}
