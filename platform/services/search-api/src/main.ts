import WebSocket, { WebSocketServer } from 'ws';
import { Client } from 'pg';
import pino from 'pino';
import { embedText, warmupEmbedder } from 'semantic-embedder';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const db = new Client({
  connectionString: process.env.POSTGRES_URL
});

const PORT = Number(process.env.PORT || 3001);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * Sanitizers (strict)
 */
function safeArray<T>(val: any): T[] | undefined {
  return Array.isArray(val) ? val : undefined;
}

function safeNumber(val: any): number | undefined {
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
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

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!Array.isArray(msg)) return;

      if (msg[0] === 'REQ') {
        const subId = msg[1];
        const filters = msg.slice(2);

        for (const filter of filters) {
          if (!filter || typeof filter !== 'object') continue;

          const search = safeString(filter.search);
          if (!search) continue;

          const limit = Math.min(
            safeNumber(filter.limit) ?? DEFAULT_LIMIT,
            MAX_LIMIT
          );

          const kinds = safeArray<number>(filter.kinds);
          const authors = safeArray<string>(filter.authors);
          const since = safeNumber(filter.since);
          const until = safeNumber(filter.until);

          // Cursor (option B)
          const cursorScore = safeNumber(filter.cursor_score);
          const cursorTs = safeNumber(filter.cursor_ts);

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
                  AND ($4::timestamptz IS NULL OR sd.created_at >= to_timestamp($4))
                  AND ($5::timestamptz IS NULL OR sd.created_at <= to_timestamp($5))
                  AND (
                    sd.fts @@ q.query
                    OR sd.embedding IS NOT NULL
                  )
              )
            SELECT raw, rrf_score, created_at
            FROM ranked
            WHERE
              ($7::float IS NULL OR $8::timestamptz IS NULL)
              OR (rrf_score, created_at) < ($7, to_timestamp($8))
            ORDER BY rrf_score DESC, created_at DESC
            LIMIT $9
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
              limit
            ]
          );

          let lastScore: number | null = null;
          let lastTs: number | null = null;

          for (const row of res.rows) {
            ws.send(JSON.stringify(['EVENT', subId, row.raw]));
            lastScore = row.rrf_score;
            lastTs = Math.floor(new Date(row.created_at).getTime() / 1000);
          }

          if (lastScore !== null && lastTs !== null) {
            ws.send(JSON.stringify([
              'NOTICE',
              JSON.stringify({
                type: 'cursor',
                cursor_score: lastScore,
                cursor_ts: lastTs
              })
            ]));
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

async function main() {
  await db.connect();
  log.info('warming semantic embedder');
  await warmupEmbedder();
  log.info(`search relay (hybrid + RRF + pagination) running on :${PORT}`);
}

main().catch((err) => {
  log.fatal({ err }, 'search relay crashed');
  process.exit(1);
});
