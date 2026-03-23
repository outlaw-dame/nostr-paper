const COMPOSE_SEARCH_PARAM = 'compose'
const QUOTE_SEARCH_PARAM = 'quote'
const REPLY_SEARCH_PARAM = 'reply'
const STORY_SEARCH_PARAM = 'story'

export function isComposeOpen(search: string): boolean {
  return new URLSearchParams(search).get(COMPOSE_SEARCH_PARAM) === '1'
}

export function getComposeQuoteReference(search: string): string | null {
  return new URLSearchParams(search).get(QUOTE_SEARCH_PARAM)
}

export function getComposeReplyReference(search: string): string | null {
  return new URLSearchParams(search).get(REPLY_SEARCH_PARAM)
}

export function getComposeStoryMode(search: string): boolean {
  return new URLSearchParams(search).get(STORY_SEARCH_PARAM) === '1'
}

export function buildComposeSearch(
  currentSearch: string,
  options: {
    quoteReference?: string | null
    replyReference?: string | null
    story?: boolean | null
  } = {},
): string {
  const params = new URLSearchParams(currentSearch)
  params.set(COMPOSE_SEARCH_PARAM, '1')

  if (options.quoteReference) {
    params.set(QUOTE_SEARCH_PARAM, options.quoteReference)
  } else if (options.quoteReference === null) {
    params.delete(QUOTE_SEARCH_PARAM)
  }

  if (options.replyReference) {
    params.set(REPLY_SEARCH_PARAM, options.replyReference)
  } else if (options.replyReference === null) {
    params.delete(REPLY_SEARCH_PARAM)
  }

  if (options.story === true) {
    params.set(STORY_SEARCH_PARAM, '1')
  } else if (options.story === false || options.story === null) {
    params.delete(STORY_SEARCH_PARAM)
  }

  const next = params.toString()
  return next ? `?${next}` : ''
}

export function clearComposeSearch(currentSearch: string): string {
  const params = new URLSearchParams(currentSearch)
  params.delete(COMPOSE_SEARCH_PARAM)
  params.delete(QUOTE_SEARCH_PARAM)
  params.delete(REPLY_SEARCH_PARAM)
  params.delete(STORY_SEARCH_PARAM)
  const next = params.toString()
  return next ? `?${next}` : ''
}
