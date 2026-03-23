function getNip44Api(): NostrNip04Api | null {
  if (typeof window === 'undefined') return null
  return window.nostr?.nip44 ?? null
}

export function hasNip44Support(): boolean {
  return getNip44Api() !== null
}

export async function encryptNip44(
  pubkey: string,
  plaintext: string,
): Promise<string> {
  if (typeof pubkey !== 'string' || pubkey.trim().length !== 64) {
    throw new Error('NIP-44 encryption requires a valid recipient pubkey.')
  }
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('NIP-44 encryption requires a non-empty plaintext payload.')
  }

  const nip44 = getNip44Api()
  if (!nip44) {
    throw new Error('Your signer does not expose NIP-44 encryption.')
  }

  return nip44.encrypt(pubkey, plaintext)
}

export async function decryptNip44(
  pubkey: string,
  ciphertext: string,
): Promise<string> {
  if (typeof pubkey !== 'string' || pubkey.trim().length !== 64) {
    throw new Error('NIP-44 decryption requires a valid counterparty pubkey.')
  }
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw new Error('NIP-44 decryption requires a non-empty ciphertext payload.')
  }

  const nip44 = getNip44Api()
  if (!nip44) {
    throw new Error('Your signer does not expose NIP-44 decryption.')
  }

  return nip44.decrypt(pubkey, ciphertext)
}
