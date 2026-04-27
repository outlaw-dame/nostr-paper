export function isRemoteImportEnabled(currentUserPubkey: string | null | undefined): boolean {
  return Boolean(currentUserPubkey)
}
