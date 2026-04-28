import WebSocket, { WebSocketServer } from 'ws';
import { Pool } from 'pg';
import pino from 'pino';
import { embedText, warmupEmbedder } from 'semantic-embedder';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const db = new Pool({
  connectionString: process.env.POSTGRES_URL
});

const PORT = Number(process.env.PORT || 3001);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const LOG_RELAY_REQS = process.env.LOG_RELAY_REQS === 'true';

function sanitizeLimit(rawLimit: unknown): number {
  const parsed = safeNumber(rawLimit);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }
  const normalized = Math.trunc(parsed as number);
  return Math.max(1, Math.min(normalized, MAX_LIMIT));
}

/**
 * Sanitizers (strict)
 */
function safeArray<T>(val: any): T[] | undefined {
  return Array.isArray(val) ? val : undefined;
}

function safeNumber(val: any): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function safeString(val: any): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

function toPgVector(values: number[]): string {
  if (values.length === 0) {
    throw new Error('Embedding cannot be empty');
  }
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error('Embedding contains non-finite value');
    }
  }
  return `[${values.join(',')}]`;
}

function setupWebSocketServer() {
  const wss = new WebSocketServer({ port: PORT });

  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!Array.isArray(msg)) return;

      if (msg[0] === 'REQ') {
        const subId = msg[1];
        const filters = msg.slice(2);

        if (LOG_RELAY_REQS) {
          log.info({ subId, filterCount: filters.length }, 'relay REQ received');
        }

        for (const filter of filters) {
          if (!filter || typeof filter !== 'object') continue;

          const search = safeString(filter.search);
          if (!search) continue;

          // ── Thread fetch ──────────────────────────────────────────────────
          // thread_id:      fetch all events whose root_id = <event-id> (NIP-10 / NIP-22 by event id)
          // thread_address: fetch all NIP-22 comments whose root_address = <naddr> (addressable roots)
          const threadId      = safeString(filter.thread_id);
          const threadAddress = safeString(filter.thread_address);

          if (threadId || threadAddress) {
            const limit = sanitizeLimit(filter.limit);
            const kinds = safeArray<number>(filter.kinds);

            let threadRows: { event_id: string; raw: unknown }[];

            if (threadId) {
              // Include the root event itself (er.id = $1) plus all descendants
              // (sd.root_id = $1). Results ordered oldest-first for tree rendering.
              const res = await db.query(
                `
                SELECT er.id AS event_id, er.raw, sd.created_at
                FROM search_docs sd
                JOIN events_raw er ON er.id = sd.event_id
                WHERE
                  sd.is_searchable = true
                  AND sd.moderation_state = 'allowed'
                  AND er.deleted_at IS NULL
                  AND (sd.root_id = $1 OR er.id = $1)
                  AND ($2::int[] IS NULL OR sd.kind = ANY($2))
                ORDER BY sd.created_at ASC
                LIMIT $3
                `,
                [threadId, kinds ?? null, limit],
              );
              threadRows = res.rows;
            } else {
              // Addressable root (e.g. NIP-23 article): fetch all NIP-22 comments.
              const res = await db.query(
                `
                SELECT er.id AS event_id, er.raw, sd.created_at
                FROM search_docs sd
                JOIN events_raw er ON er.id = sd.event_id
                WHERE
                  sd.is_searchable = true
                  AND sd.moderation_state = 'allowed'
                  AND er.deleted_at IS NULL
                  AND sd.root_address = $1
                  AND ($2::int[] IS NULL OR sd.kind = ANY($2))
                ORDER BY sd.created_at ASC
                LIMIT $3
                `,
                [threadAddress, kinds ?? null, limit],
              );
              threadRows = res.rows;
            }

            for (const row of threadRows) {
              ws.send(JSON.stringify(['EVENT', subId, row.raw]));
            }
            ws.send(JSON.stringify(['EOSE', subId]));
            continue;
          }
          // ─────────────────────────────────────────────────────────────────


          const limit = sanitizeLimit(filter.limit);

          const kinds = safeArray<number>(filter.kinds);
          const authors = safeArray<string>(filter.authors);
          const since = safeNumber(filter.since);
          const until = safeNumber(filter.until);

          // Cursor (option B)
          const cursorScore = safeNumber(filter.cursor_score);
          const cursorTs = safeNumber(filter.cursor_ts);
          const cursorId = safeString(filter.cursor_id);

          if (LOG_RELAY_REQS) {
            log.info(
              {
                subId,
                search,
                limit,
                kindsCount: kinds?.length ?? 0,
                authorsCount: authors?.length ?? 0,
                since,
                until,
                hasCursor: cursorScore !== undefined && cursorTs !== undefined,
                cursorId: cursorId ?? null,
              },
              'relay search request',
            );
          }

          const embedding = await embedText(search);
          const pgVector = toPgVector(embedding);

          const res = await db.query(
            `
            WITH
              q AS (
                SELECT websearch_to_tsquery('simple', $1) AS query
              ),
              ranked AS (
                SELECT
                  er.id AS event_id,
                  er.raw,
                  sd.created_at,
                  ts_rank_cd(sd.fts, q.query) AS lexical_score,
                  (1 - (sd.embedding <=> $6::vector)) AS semantic_score,
                  (
                    1.0 / (60 + ROW_NUMBER() OVER (
                      ORDER BY ts_rank_cd(sd.fts, q.query) DESC
                    ))
                    +
                    1.0 / (60 + ROW_NUMBER() OVER (
                      ORDER BY (1 - (sd.embedding <=> $6::vector)) DESC
                    ))
                  ) AS rrf_score
                FROM search_docs sd
                JOIN events_raw er ON er.id = sd.event_id
                JOIN q ON true
                WHERE
                  sd.is_searchable = true
                  AND sd.moderation_state = 'allowed'
                  AND er.deleted_at IS NULL
                  AND ($2::int[] IS NULL OR sd.kind = ANY($2))
                  AND ($3::text[] IS NULL OR sd.author_pubkey = ANY($3))
                  AND ($4::double precision IS NULL OR sd.created_at >= to_timestamp($4))
                  AND ($5::double precision IS NULL OR sd.created_at <= to_timestamp($5))
                  AND (
                    sd.fts @@ q.query
                    OR sd.embedding IS NOT NULL
                  )
              )
            SELECT event_id, raw, rrf_score, created_at
            FROM ranked
            WHERE
              ($7::double precision IS NULL OR $8::double precision IS NULL)
              OR (
                $9::text IS NULL
                AND (rrf_score, created_at) < ($7, to_timestamp($8))
              )
              OR (
                $9::text IS NOT NULL
                AND (rrf_score, created_at, event_id) < ($7, to_timestamp($8), $9)
              )
            ORDER BY rrf_score DESC, created_at DESC, event_id DESC
            LIMIT $10
            `,
            [
              search,
              kinds ?? null,
              authors ?? null,
              since ?? null,
              until ?? null,
              pgVector,
              cursorScore ?? null,
              cursorTs ?? null,
              cursorId ?? null,
              limit
            ]
          );

          let lastScore: number | null = null;
          let lastTs: number | null = null;
          let lastId: string | null = null;

          for (const row of res.rows) {
            ws.send(JSON.stringify(['EVENT', subId, row.raw]));
            const score = Number(row.rrf_score);
            lastScore = Number.isFinite(score) ? score : null;
            lastTs = new Date(row.created_at).getTime() / 1000;
            lastId = safeString(row.event_id) ?? null;
          }

          if (lastScore !== null && lastTs !== null && lastId !== null) {
            ws.send(JSON.stringify([
              'NOTICE',
              JSON.stringify({
                type: 'cursor',
                cursor_score: lastScore,
                cursor_ts: lastTs,
                cursor_id: lastId
              })
            ]));
          }

          if (LOG_RELAY_REQS) {
            log.info(
              {
                subId,
                search,
                resultCount: res.rows.length,
                nextCursor: lastId !== null
                  ? { cursor_score: lastScore, cursor_ts: lastTs, cursor_id: lastId }
                  : null,
              },
              'relay search response',
            );
          }
        }

        ws.send(JSON.stringify(['EOSE', subId]));
      }

      if (msg[0] === 'CLOSE') {
        return;
      }
    } catch (err) {
      log.error({ err }, 'search relay error');
      try {
        ws.send(JSON.stringify(['NOTICE', 'invalid request']));
      } catch {}
    }
    });

    ws.on('error', (err) => {
      log.error({ err }, 'ws error');
    });
  });

  return wss;
}

async function main() {
  await db.query('SELECT 1');
  log.info('warming semantic embedder');
  await warmupEmbedder();
  setupWebSocketServer();
  log.info(`search relay (hybrid + RRF + pagination) running on :${PORT}`);
}

main().catch((err) => {
  log.fatal({ err }, 'search relay crashed');
  process.exit(1);
});
