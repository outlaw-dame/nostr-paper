declare module 'semantic-embedder' {
  export function embedText(text: string): Promise<number[]>;
  export function warmupEmbedder(): Promise<void>;
}
