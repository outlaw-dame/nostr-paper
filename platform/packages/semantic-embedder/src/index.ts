import * as ONNX_WEB_WASM from 'onnxruntime-web/wasm';

const MODEL_ID = process.env.EMBEDDING_MODEL_ID || 'Xenova/all-MiniLM-L6-v2';
const EXPECTED_DIM = Number(process.env.EMBEDDING_DIM || 384);
const INIT_RETRIES = Number(process.env.EMBEDDING_INIT_RETRIES || 3);
const FORCE_WASM_RUNTIME = process.env.EMBEDDING_FORCE_WASM !== 'false';
const ORT_SYMBOL = Symbol.for('onnxruntime');

type Extractor = (text: string, options: { pooling: 'mean'; normalize: true }) => Promise<{
  data: Float32Array | number[];
  dims?: number[];
}>;

type TransformersModule = typeof import('@huggingface/transformers');

let extractorPromise: Promise<Extractor> | null = null;
let transformersPromise: Promise<TransformersModule> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextDelay(attempt: number, baseMs = 500, maxMs = 5000) {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * Math.min(250, exp));
  return exp + jitter;
}

async function getTransformers(): Promise<TransformersModule> {
  if (!transformersPromise) {
    transformersPromise = (async () => {
      if (FORCE_WASM_RUNTIME && !(ORT_SYMBOL in globalThis)) {
        const ort = (ONNX_WEB_WASM as { default?: unknown }).default ?? ONNX_WEB_WASM;
        Object.defineProperty(globalThis, ORT_SYMBOL, {
          value: ort,
          configurable: true,
          enumerable: false,
          writable: false,
        });
      }

      const mod = await import('@huggingface/transformers');

      if (FORCE_WASM_RUNTIME && mod.env.backends.onnx.wasm) {
        mod.env.backends.onnx.wasm.proxy = false;
        mod.env.backends.onnx.wasm.numThreads = 1;
      }

      return mod;
    })();
  }

  return transformersPromise;
}

async function initExtractor(): Promise<Extractor> {
  let lastError: unknown;
  for (let attempt = 0; attempt < INIT_RETRIES; attempt++) {
    try {
      const { pipeline } = await getTransformers();
      return (await pipeline('feature-extraction', MODEL_ID, {
        session_options: FORCE_WASM_RUNTIME
          ? { executionProviders: ['wasm'] }
          : undefined,
      })) as unknown as Extractor;
    } catch (err) {
      lastError = err;
      if (attempt < INIT_RETRIES - 1) {
        await sleep(nextDelay(attempt));
      }
    }
  }
  throw lastError;
}

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = initExtractor();
  }
  return extractorPromise;
}

export async function embedText(text: string): Promise<number[]> {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error('Cannot embed empty text');
  }
  const extractor = await getExtractor();
  const output = await extractor(normalized, {
    pooling: 'mean',
    normalize: true,
  });
  const tensor = output as { data: Float32Array | number[]; dims?: number[] };
  const data = Array.from(tensor.data);
  if (data.length !== EXPECTED_DIM) {
    throw new Error(
      `Unexpected embedding dimension: expected ${EXPECTED_DIM}, got ${data.length}`
    );
  }
  return data;
}

export async function warmupEmbedder(): Promise<void> {
  await embedText('warmup');
}
