import { isValidHex32 } from '@/lib/security/sanitize'

function getNip04Api(): NostrNip04Api | null {
  if (typeof window === 'undefined') return null
  return window.nostr?.nip04 ?? null
}

export function hasNip04Support(): boolean {
  return getNip04Api() !== null
}

export async function encryptNip04(
  pubkey: string,
  plaintext: string,
): Promise<string> {
  if (!isValidHex32(pubkey)) {
    throw new Error('NIP-04 encryption requires a valid recipient pubkey.')
  }
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('NIP-04 encryption requires a non-empty plaintext payload.')
  }

  const nip04 = getNip04Api()
  if (!nip04) {
    throw new Error('Your signer does not expose NIP-04 encryption.')
  }

  return nip04.encrypt(pubkey, plaintext)
}

export async function decryptNip04(
  pubkey: string,
  ciphertext: string,
): Promise<string> {
  if (!isValidHex32(pubkey)) {
    throw new Error('NIP-04 decryption requires a valid counterparty pubkey.')
  }
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw new Error('NIP-04 decryption requires a non-empty ciphertext payload.')
  }

  const nip04 = getNip04Api()
  if (!nip04) {
    throw new Error('Your signer does not expose NIP-04 decryption.')
  }

  return nip04.decrypt(pubkey, ciphertext)
}
