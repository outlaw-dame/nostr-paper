export interface TranslationServiceErrorOptions {
  code: 'config' | 'network' | 'provider' | 'parse' | 'same-language' | 'unavailable'
  status?: number
}

export class TranslationServiceError extends Error {
  readonly code: TranslationServiceErrorOptions['code']
  readonly status: number | undefined

  constructor(message: string, options: TranslationServiceErrorOptions) {
    super(message)
    this.name = 'TranslationServiceError'
    this.code = options.code
    this.status = options.status
  }
}
