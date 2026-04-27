import { readFileSync } from 'fs'

const envLocal = readFileSync('/Users/damonoutlaw/Downloads/nostr-paper/.env.local', 'utf8')
const KEY = envLocal.match(/VITE_GEMINI_API_KEY=(.+)/)?.[1]?.trim()

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

function qualityScore(text) {
  const compact = text.trim()
  if (!compact) return 0
  const lengthScore = Math.min(1, compact.length / 220)
  const sentenceCount = compact.split(/[.!?]+/).map(c => c.trim()).filter(Boolean).length
  const sentenceScore = Math.min(1, sentenceCount / 2)
  const words = compact.toLowerCase().split(/\s+/).filter(Boolean)
  const unique = new Set(words)
  const diversity = words.length === 0 ? 0 : unique.size / words.length
  const markdownPenalty = compact.includes('```') ? 0.2 : 0
  const diversityPenalty = diversity < 0.45 ? 0.15 : 0
  return Math.max(0, (lengthScore * 0.4) + (sentenceScore * 0.35) + (diversity * 0.25) - markdownPenalty - diversityPenalty)
}

async function callGemini(model, prompt) {
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${KEY}`
  const body = {
    systemInstruction: { role: 'system', parts: [{ text: 'You are a concise writing-quality assistant. Return plain text only.' }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.25 }
  }
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  return json.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim() ?? ''
}

const prompts = {
  'compose_assist': 'Write 2 to 3 sentences of specific, actionable guidance to improve this social post.\nDraft: "Just had a great time at the conference. Learned so much about nostr. Really enjoyed the talks."\nTone: casual.'
}

async function run() {
  for (const model of ['gemini-2.5-flash', 'gemini-3.1-flash-lite-preview']) {
    console.log(`\n=== ${model} ===`)
    const output = await callGemini(model, prompts.compose_assist)
    const score = qualityScore(output)
    console.log(`[compose_assist] score=${score.toFixed(4)}\nOutput: ${output}\n`)
  }
  process.exit(0)
}
run()
