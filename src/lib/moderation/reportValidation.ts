export function isValidModeratorPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value.trim())
}
