import pino from 'pino';
import { Config } from './config.js';

export function createLogger(config: Config) {
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'password', '*.secret'],
      remove: true
    },
    base: {
      service: 'ingestion-bridge',
      bridge: config.BRIDGE_NAME
    }
  });
}
