import { buildExtremeHarmModerationPrompt } from '@/lib/moderation/prompts'
import type { SearchIntent } from '@/types'

/**
 * Prompt builders for every on-device LLM component.
 *
 * COMPONENT MAP — each section targets a distinct model with incompatible
 * generation settings.  Do NOT mix builders across components.
 *
 * ┌──────────────────────────┬────────────────────────────────────────────────┐
 * │ Component                │ Prompt builders                                │
 * ├──────────────────────────┼────────────────────────────────────────────────┤
 * │ Search Intent Router     │ buildSearchIntentSystemPrompt()                │
 * │  router.worker.ts        │ buildSearchIntentUserPrompt()                  │
 * │  temp=0, max_tokens=4    │ buildSearchIntentSinglePrompt()                │
 * │  output: lexical|semantic│ SEARCH_INTENT_EVAL_CASES                       │
 * │         |hybrid only     │                                                │
 * ├──────────────────────────┼────────────────────────────────────────────────┤
 * │ Grounded Answer          │ buildGroundedAnswerPrompt()                    │
 * │  SearchAiAnswer.tsx      │ (via groundedAnswer.ts)                        │
 * │  temp=0.2, max_tokens=   │                                                │
 * │  320, free-form text     │                                                │
 * ├──────────────────────────┼────────────────────────────────────────────────┤
 * │ Extreme-Harm Moderation  │ buildExtremeHarmModerationPrompt()             │
 * │  LiteRtPrototypePage.tsx │ (eval/prototype only — production moderation   │
 * │  LLM-based eval path     │  uses a classifier pipeline, not this prompt)  │
 * └──────────────────────────┴────────────────────────────────────────────────┘
 */

// ── AI Component: Search Intent Router ────────────────────────────────────────
// Used by: router.worker.ts → routerHarness.ts
// Model: small instruction-tuned LLM (Gemma 270M ONNX / WebLLM / LiteRT router model)
// Output contract: exactly one of "lexical" | "semantic" | "hybrid" — no other tokens
export interface SearchIntentEvalCase {
  query: string
  expectedIntent: SearchIntent
  notes: string
}

export const SEARCH_INTENT_EVAL_CASES: SearchIntentEvalCase[] = [
  { query: '#bitcoin', expectedIntent: 'lexical', notes: 'single hashtag' },
  { query: '#nostr #lightning', expectedIntent: 'lexical', notes: 'multiple hashtags' },
  { query: '@alice', expectedIntent: 'lexical', notes: 'mention lookup' },
  { query: 'npub1xyzabc123', expectedIntent: 'lexical', notes: 'bech32 identifier' },
  { query: 'posts about climate change', expectedIntent: 'semantic', notes: 'topic search' },
  { query: 'what is zapping in nostr', expectedIntent: 'semantic', notes: 'concept question' },
  { query: 'how does lightning network work', expectedIntent: 'semantic', notes: 'natural-language question' },
  { query: 'decentralized social media explained', expectedIntent: 'semantic', notes: 'concept description' },
  { query: 'bitcoin price discussion from alice', expectedIntent: 'hybrid', notes: 'keyword plus subject context' },
  { query: '#bitcoin analysis today', expectedIntent: 'hybrid', notes: 'hashtag plus conceptual modifier' },
  { query: 'nostr posts from @alice about relays', expectedIntent: 'hybrid', notes: 'exact entity plus semantic filter' },
  { query: 'latest note from npub1xyzabc123 about wallets', expectedIntent: 'hybrid', notes: 'id plus topic constraint' },
] as const

const SEARCH_INTENT_EXAMPLES = SEARCH_INTENT_EVAL_CASES.slice(0, 10)

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function buildSearchIntentSystemPrompt(): string {
  const examples = SEARCH_INTENT_EXAMPLES.map((example) => [
    '  <example>',
    `    <query>${escapeXml(example.query)}</query>`,
    `    <label>${example.expectedIntent}</label>`,
    `    <note>${escapeXml(example.notes)}</note>`,
    '  </example>',
  ].join('\n')).join('\n')

  return [
    '<role>You are a search intent classifier for a Nostr social media search engine.</role>',
    '<goal>Classify each query as lexical, semantic, or hybrid.</goal>',
    '<definitions>',
    '  <lexical>Contains hashtags, mentions, event ids, profile ids, or short exact-match entity lookups.</lexical>',
    '  <semantic>Asks for a concept, topic, explanation, or natural-language subject search.</semantic>',
    '  <hybrid>Mixes an exact-match entity or keyword with conceptual or topical context.</hybrid>',
    '</definitions>',
    '<instructions>',
    'Return exactly one word: lexical, semantic, or hybrid.',
    'Do not add punctuation, explanation, JSON, or extra tokens.',
    '</instructions>',
    '<examples>',
    examples,
    '</examples>',
  ].join('\n')
}

export function buildSearchIntentUserPrompt(query: string): string {
  return [
    '<task>Classify the query below.</task>',
    `<query>${escapeXml(query)}</query>`,
    '<required_output>Return exactly one word: lexical, semantic, or hybrid.</required_output>',
  ].join('\n')
}

export function buildSearchIntentSinglePrompt(query: string): string {
  return [
    buildSearchIntentSystemPrompt(),
    '',
    buildSearchIntentUserPrompt(query),
  ].join('\n')
}

// ── AI Component: Grounded Answer Synthesis ───────────────────────────────────
// Used by: SearchAiAnswer.tsx → groundedAnswer.ts → litert.ts
// Model: capable generative LLM (LiteRT Gemma 3N E2B / VITE_LITERT_MODEL_PATH)
// Output contract: free-form prose answer grounded in supplied documents only
export interface GroundedAnswerDocument {
  source: string
  content: string
}

export function buildGroundedAnswerPrompt(
  question: string,
  documents: GroundedAnswerDocument[],
): string {
  const renderedDocuments = documents.map((document, index) => [
    `  <document index="${index + 1}">`,
    `    <source>${escapeXml(document.source)}</source>`,
    `    <document_content>${escapeXml(document.content)}</document_content>`,
    '  </document>',
  ].join('\n')).join('\n')

  return [
    '<role>You answer questions using only the supplied context.</role>',
    '<instructions>',
    'First extract 1 to 3 short verbatim quotes from the context that are most relevant.',
    'Then answer using only those documents as evidence.',
    'If the context is insufficient, say "insufficient context".',
    '</instructions>',
    '<documents>',
    renderedDocuments,
    '</documents>',
    `<question>${escapeXml(question)}</question>`,
  ].join('\n')
}

export interface PromptPreset {
  id: 'router-intent' | 'extreme-harm-moderation' | 'grounded-answer'
  title: string
  description: string
  buildInput: () => string
}

export const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'router-intent',
    title: 'Search Intent Router',
    description: 'Structured one-label query classification used by the search router worker.',
    buildInput: () => buildSearchIntentSinglePrompt('#nostr bitcoin analysis'),
  },
  {
    id: 'extreme-harm-moderation',
    title: 'Extreme-Harm Moderation',
    description: 'High-precision block-or-allow moderation prompt for the most severe content only.',
    buildInput: () => buildExtremeHarmModerationPrompt('I know where you live and I am going to kill you tonight.'),
  },
  {
    id: 'grounded-answer',
    title: 'Grounded Answer Synthesis',
    description: 'Quote-first answering pattern for retrieved Nostr or profile context.',
    buildInput: () => buildGroundedAnswerPrompt(
      'What is zapping in Nostr?',
      [
        {
          source: 'note-1',
          content: 'A zap is a Lightning payment sent as a reaction to a Nostr note or profile.',
        },
        {
          source: 'note-2',
          content: 'Clients often display zap counts next to likes, replies, and reposts.',
        },
      ],
    ),
  },
]