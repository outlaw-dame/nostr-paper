import { z } from 'zod';

const ConfigSchema = z.object({
  STRFRY_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  REDIS_STREAM: z.string().default('events.ingest'),
  REDIS_DEDUPE_TTL_SEC: z.coerce.number().int().positive().default(604800),
  BRIDGE_NAME: z.string().default('ingestion-bridge-1'),
  BOOTSTRAP_SINCE_SEC: z.coerce.number().int().positive().default(300),
  REPLAY_WINDOW_SEC: z.coerce.number().int().positive().default(10),
  MAX_EVENT_BYTES: z.coerce.number().int().positive().default(131072),
  MAX_TAGS: z.coerce.number().int().positive().default(1000),
  LOG_LEVEL: z.enum(['trace','debug','info','warn','error','fatal']).default('info')
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
