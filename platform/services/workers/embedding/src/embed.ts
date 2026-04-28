import crypto from 'node:crypto';

export function embedText(text: string, dim = 384): number[] {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vector: number[] = [];
  for (let i = 0; i < dim; i++) {
    const byte = hash[i % hash.length];
    vector.push((byte / 255) * 2 - 1);
  }
  const norm = Math.sqrt(vector.reduce((s,v)=>s+v*v,0));
  return norm === 0 ? vector : vector.map(v=>v/norm);
}
