# Relay extraction runbook

This runbook performs the history-preserving extraction after the destination relay repository has been provisioned.

## Preconditions

- Work from a clean clone of `outlaw-dame/nostr-paper`.
- Confirm `main` is current and CI is green.
- Provision an empty destination repository for the relay/search stack.
- Do not use `outlaw-dame/nostr-paper-platform`; it is unrelated.
- Keep `platform/services/blossom-edge/` out of the relay extraction.

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

Inspect the resulting history and tree before pushing:

```bash
git log --oneline --decorate -20
git status --short
find . -maxdepth 3 -type f | sort
```

Add the new repository and push only after inspection:

```bash
git remote remove origin
git remote add origin git@github.com:outlaw-dame/RELAY_REPOSITORY_NAME.git
git push -u origin main
```

## Post-extraction work in the relay repository

1. Add a relay-specific root README and architecture diagram.
2. Add root package/workspace metadata if the extracted tree requires it.
3. Repair relative paths that assumed the former `platform/` prefix.
4. Add CI for type-checking, unit tests, integration tests, replay tests, migrations, and container builds.
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
