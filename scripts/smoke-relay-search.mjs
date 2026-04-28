#!/usr/bin/env node

const APP_URL = (process.env.APP_URL ?? 'http://127.0.0.1:4173').replace(/\/+$/, '');
const RELAY_URL = process.env.RELAY_URL ?? 'ws://127.0.0.1:3301';
const QUERY = process.env.SEARCH_QUERY ?? 'nostr search seed 1';
const RELAY_TIMEOUT_MS = Number(process.env.RELAY_TIMEOUT_MS ?? 8000);
const UI_TIMEOUT_MS = Number(process.env.UI_TIMEOUT_MS ?? 15000);

function log(msg, data) {
  if (data === undefined) {
    console.log(`[smoke-relay] ${msg}`);
    return;
  }
  console.log(`[smoke-relay] ${msg}`, data);
}

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryRelay() {
  if (typeof WebSocket === 'undefined') {
    throw new Error('WebSocket is not available in this Node runtime.');
  }

  const subId = `smoke-${Date.now()}`;
  const ws = new WebSocket(RELAY_URL);
  const events = [];

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`Relay request timed out after ${RELAY_TIMEOUT_MS}ms`));
    }, RELAY_TIMEOUT_MS);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(['REQ', subId, { search: QUERY, limit: 10 }]));
    });

    ws.addEventListener('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw.data));
      } catch {
        return;
      }

      if (!Array.isArray(msg) || msg[1] !== subId) return;
      if (msg[0] === 'EVENT' && msg[2] && typeof msg[2] === 'object') {
        events.push(msg[2]);
      }
      if (msg[0] === 'EOSE') {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        resolve(events);
      }
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error(`Failed to connect to relay at ${RELAY_URL}`));
    });
  });
}

async function runBrowserAssertion() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return {
      skipped: true,
      reason: 'Playwright is not installed; skipped browser assertion.',
    };
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const seenSockets = new Set();
    page.on('websocket', (socket) => {
      seenSockets.add(socket.url());
    });

    const url = `${APP_URL}/explore?q=${encodeURIComponent(QUERY)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: UI_TIMEOUT_MS });

    await page.waitForSelector('input[type="search"], [role="searchbox"]', {
      timeout: UI_TIMEOUT_MS,
    });

    let foundSeedText = false;
    const deadline = Date.now() + UI_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const bodyText = await page.locator('body').innerText();
      if (bodyText.toLowerCase().includes(QUERY.toLowerCase())) {
        foundSeedText = true;
        break;
      }
      await waitFor(400);
    }

    const relaySocketSeen = [...seenSockets].some((socketUrl) =>
      socketUrl.includes('127.0.0.1:3301') || socketUrl.includes('/relay'),
    );

    if (!relaySocketSeen) {
      throw new Error('Browser did not open a relay websocket to 127.0.0.1:3301 or /relay.');
    }

    if (!foundSeedText) {
      throw new Error(`UI did not render expected search text: ${QUERY}`);
    }

    return { skipped: false, relaySocketSeen, foundSeedText };
  } finally {
    await browser.close();
  }
}

async function main() {
  log('Starting relay smoke test', { APP_URL, RELAY_URL, QUERY });

  const events = await queryRelay();
  if (events.length === 0) {
    throw new Error(`Relay returned no events for query: ${QUERY}`);
  }

  const hasSeedText = events.some((event) =>
    String(event?.content ?? '').toLowerCase().includes(QUERY.toLowerCase()),
  );

  if (!hasSeedText) {
    throw new Error('Relay responded, but did not include expected seeded search content.');
  }

  log('Relay query passed', {
    eventCount: events.length,
    sampleIds: events.slice(0, 5).map((event) => event.id),
  });

  const browserResult = await runBrowserAssertion();
  if (browserResult.skipped) {
    log(browserResult.reason);
  } else {
    log('Browser assertion passed', browserResult);
  }

  log('Smoke test passed');
}

main().catch((error) => {
  log('Smoke test failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
