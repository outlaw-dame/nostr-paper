import { Pool } from 'pg';
import pino from 'pino';
import {
  ensureModerationStateSchema,
  evaluateKeywordBlock,
  reconcileSearchDocModerationState,
  upsertKeywordBlock,
} from './moderationState.js';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

function parseRawEvent(raw: unknown): { created_at?: number; content?: string; tags?: string[][] } | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as { created_at?: number; content?: string; tags?: string[][] };
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') {
    return raw as { created_at?: number; content?: string; tags?: string[][] };
  }
  return null;
}

async function main() {
  const pg = new Pool({ connectionString: process.env.POSTGRES_URL });

  try {
    await ensureModerationStateSchema(pg);

    const rows = await pg.query<{ event_id: string; raw: unknown }>(`
      SELECT er.id AS event_id, er.raw
      FROM events_raw er
      JOIN search_docs sd ON sd.event_id = er.id
      WHERE er.deleted_at IS NULL
    `);

    let keywordBlockCount = 0;

    await pg.query('BEGIN');
    await pg.query('TRUNCATE keyword_blocks');

    for (const row of rows.rows) {
      const event = parseRawEvent(row.raw);
      if (!event) continue;

      const decision = evaluateKeywordBlock(event);
      if (!decision) continue;

      await upsertKeywordBlock(pg, row.event_id, decision);
      keywordBlockCount += 1;
    }

    await reconcileSearchDocModerationState(pg);
    await pg.query('COMMIT');

    log.info({ scannedEvents: rows.rowCount, keywordBlockCount }, 'moderation reconciliation complete');
  } catch (error) {
    try {
      await pg.query('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  log.error({ err: error }, 'moderation reconciliation failed');
  process.exitCode = 1;
});