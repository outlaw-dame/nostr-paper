FROM ghcr.io/hoytech/strfry:latest

USER root

RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache nodejs; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update \
      && apt-get install -y --no-install-recommends nodejs ca-certificates \
      && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "No supported package manager found for installing nodejs" >&2; \
      exit 1; \
    fi

COPY services/relay-policy/src /opt/nostr-paper-relay-policy
RUN chmod +x /opt/nostr-paper-relay-policy/policy.mjs
