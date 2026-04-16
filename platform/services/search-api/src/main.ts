import WebSocket, { WebSocketServer } from 'ws';
import { Client } from 'pg';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const db = new Client({ connectionString: process.env.POSTGRES_URL });

const wss = new WebSocketServer({ port: Number(process.env.PORT || 3001) });

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!Array.isArray(msg)) return;

      if (msg[0] === 'REQ') {
        const subId = msg[1];
        const filters = msg.slice(2);

        for (const filter of filters) {
          if (!filter.search) continue;

          const limit = Math.min(filter.limit || 20, 100);

          const res = await db.query(
            `WITH q AS (SELECT websearch_to_tsquery('simple', $1) AS query)
             SELECT er.raw
             FROM search_docs sd
             JOIN events_raw er ON er.id = sd.event_id
             JOIN q ON true
             WHERE sd.is_searchable = true
               AND sd.moderation_state = 'allowed'
               AND er.deleted_at IS NULL
               AND sd.fts @@ q.query
             ORDER BY ts_rank_cd(sd.fts, q.query) DESC
             LIMIT $2`,
            [filter.search, limit]
          );

          for (const row of res.rows) {
            ws.send(JSON.stringify(['EVENT', subId, row.raw]));
          }
        }

        ws.send(JSON.stringify(['EOSE', subId]));
      }
    } catch (err) {
      log.error({ err }, 'search relay error');
      ws.send(JSON.stringify(['NOTICE', 'error']));
    }
  });
});

db.connect().then(() => {
  log.info('search relay started');
}).catch(err => {
  log.fatal(err);
  process.exit(1);
});
