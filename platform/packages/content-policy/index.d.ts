export interface InternalPolicyMatchInput {
  content?: string | null;
  title?: string | null;
  summary?: string | null;
  alt?: string | null;
  hashtags?: string[];
}

export declare const INTERNAL_SYSTEM_POLICY_VERSION: 'internal-keyword-v1';
export declare const INTERNAL_SYSTEM_KEYWORD_REASON: 'keyword_extreme_harm';
export declare const INTERNAL_SYSTEM_KEYWORD_TERMS: readonly string[];

export declare function matchesInternalSystemKeywordPolicy(input: InternalPolicyMatchInput): boolean;
export declare function normalizeModerationReason(reason: string, source?: 'keyword' | 'tagr' | 'external'): string;
