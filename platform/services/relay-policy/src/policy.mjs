#!/usr/bin/env node
import readline from 'node:readline';
import {
  createRelayRateLimiter,
  parsePolicyConfig,
  strfryOutputForDecision,
} from './rateLimiter.mjs';

const limiter = createRelayRateLimiter(parsePolicyConfig(process.env));
const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  if (!line.trim()) return;

  try {
    const message = JSON.parse(line);
    const decision = limiter.evaluate(message);
    process.stdout.write(`${JSON.stringify(strfryOutputForDecision(decision))}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[relay-policy] failed to process policy message: ${reason}\n`);
  }
});
