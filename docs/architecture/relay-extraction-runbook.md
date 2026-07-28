# Relay extraction runbook

This runbook performs the history-preserving extraction after the destination relay repository has been provisioned.

## Preconditions

- Work from a clean clone of `outlaw-dame/nostr-paper`.
- Confirm `main` is current and CI is green.
- Provision an empty destination repository for the relay/search stack.
- Do not use `outlaw-dame/nostr-paper-platform`; it is unrelated.
- Keep `platform/services/blossom-edge/` out of the relay extraction.

## Automated preflight

Before creating a disposable extraction clone, validate the current source tree and the destination repository:

```bash
node scripts/relay-extraction-preflight.mjs \
  --destination git@github.com:outlaw-dame/RELAY_REPOSITORY_NAME.git
```

The full preflight fails closed unless:

- every included and explicitly excluded source path exists;
- the extraction scope does not overlap Blossom;
- the working tree is clean and `main` is checked out;
- `git-filter-repo` is installed;
- the destination is a distinct GitHub repository;
- the destination is not `outlaw-dame/nostr-paper-platform` or the source repository;
- the destination contains no branch or tag refs.

CI runs the non-destructive tree-boundary check and unit tests with:

```bash
node --test scripts/relay-extraction-preflight.test.mjs
node scripts/relay-extraction-preflight.mjs --tree-only
```

Record the source SHA printed by the full preflight in the extraction change record.

## Recommended method: git filter-repo

Create a disposable clone:

```bash
git clone https://github.com/outlaw-dame/nostr-paper.git nostr-paper-relay-extract
cd nostr-paper-relay-extract
```

Keep the relay/search paths and exclude Blossom:

```bash
git filter-repo \
  --path platform/infra/ \
  --path platform/packages/ \
  --path platform/services/ingestion-bridge/ \
  --path platform/services/relay-policy/ \
  --path platform/services/search-api/ \
  --path platform/services/workers/ \
  --path platform/docs/ \
  --path-rename platform/:
```

## Required extraction manifest

Before pushing, add `extraction-manifest.json` to the extracted repository. Use the exact source SHA emitted by the preflight:

```json
{
  "schemaVersion": 1,
  "sourceRepository": "outlaw-dame/nostr-paper",
  "sourceSha": "FULL_40_CHARACTER_SOURCE_SHA",
  "includedPaths": [
    "platform/infra",
    "platform/packages",
    "platform/services/ingestion-bridge",
    "platform/services/relay-policy",
    "platform/services/search-api",
    "platform/services/workers",
    "platform/docs"
  ],
  "excludedPaths": [
    "platform/services/blossom-edge"
  ]
}
```

Copy `scripts/verify-relay-extraction.mjs` into the extracted repository and run:

```bash
node scripts/verify-relay-extraction.mjs . extraction-manifest.json FULL_40_CHARACTER_SOURCE_SHA
```

The verifier fails closed if a required relay/search path is absent, the old `platform/` prefix remains, Blossom is present, or the manifest does not match the recorded source commit and approved boundary.

Inspect the resulting history and tree before pushing:

```bash
git log --oneline --decorate -20
git status --short
find . -maxdepth 3 -type f | sort
```

Add the new repository and push only after inspection and verifier success:

```bash
git remote remove origin
git remote add origin git@github.com:outlaw-dame/RELAY_REPOSITORY_NAME.git
git push -u origin main
```

## Post-extraction work in the relay repository

1. Add a relay-specific root README and architecture diagram.
2. Add root package/workspace metadata if the extracted tree requires it.
3. Repair relative paths that assumed the former `platform/` prefix.
4. Add CI for type-checking, unit tests, integration tests, replay tests, migrations, container builds, and extraction-boundary verification.
5. Add `.env.example` with safe defaults and no secrets.
6. Validate Docker build contexts and Compose paths.
7. Validate PostgreSQL migrations from an empty database and an upgrade fixture.
8. Validate Redis consumer-group recovery and worker shutdown.
9. Validate NIP-50 search, cursor pagination, moderation filtering, and relay policy.
10. Document deployment, rollback, backup, restore, and incident response.

## PWA migration branch

Only after the relay repository is operational:

1. inventory all `platform/` references in PWA code, scripts, docs, and workflows;
2. replace any source-level coupling with validated relay/search endpoint configuration;
3. add protocol contract fixtures for request, event, pagination, error, and fallback behavior;
4. prove the PWA builds and runs with relay and media services absent;
5. prove remote search works against the extracted relay;
6. remove the extracted relay paths from `nostr-paper` in a separate reviewed PR.

## Media decision

Do not move `platform/services/blossom-edge/` as part of the relay extraction. Decide separately whether it remains in `nostr-paper` or moves to a dedicated media repository. Preserve its independent Wrangler, R2, Blossom, and Filebase/IPFS lifecycle.

## Rollback

Until the final removal PR is merged, `nostr-paper/main` remains the rollback source for the relay implementation. Do not delete the original subtree or rewrite the source repository history.
