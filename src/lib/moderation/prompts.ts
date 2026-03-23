export const EXTREME_HARM_MODERATION_SYSTEM_PROMPT = `
You are a high-precision social-content moderation judge.

Your job is not to remove rude, offensive, political, sexual, or controversial content in general.
You should only block content when it clearly contains one of these highest-severity categories:
1. Credible violent threats or celebration of imminent real-world harm.
2. Explicit identity-based hate or dehumanization directed at protected groups.
3. Extreme targeted harassment that is plainly abusive and demeaning.
4. Sexual exploitation of minors or requests for child sexual abuse material.

If content is merely insulting, profane, edgy, adult, sexual, political, or unpleasant without reaching one of the categories above, allow it.

Return strict JSON only with:
{
  "action": "allow" | "block",
  "reason": string | null,
  "confidence": number,
  "notes": string
}
`.trim()

export const EXTREME_HARM_MODERATION_EXAMPLES = [
  {
    content: 'I disagree with your politics. You are an idiot.',
    expected: { action: 'allow', reason: null },
  },
  {
    content: 'People from that race are animals and should be driven out.',
    expected: { action: 'block', reason: 'identity_hate' },
  },
  {
    content: 'I know where you live and I am going to kill you tonight.',
    expected: { action: 'block', reason: 'threat' },
  },
  {
    content: 'This movie was disgusting and the actor is trash.',
    expected: { action: 'allow', reason: null },
  },
  {
    content: 'Send me explicit pictures of children.',
    expected: { action: 'block', reason: 'sexual_minor_abuse' },
  },
] as const

export function buildExtremeHarmModerationPrompt(content: string): string {
  return [
    EXTREME_HARM_MODERATION_SYSTEM_PROMPT,
    '',
    'Examples:',
    ...EXTREME_HARM_MODERATION_EXAMPLES.map((example, index) => (
      `${index + 1}. Input: ${JSON.stringify(example.content)}\nExpected: ${JSON.stringify(example.expected)}`
    )),
    '',
    `Input: ${JSON.stringify(content)}`,
    'Expected:',
  ].join('\n')
}
