export interface InternalPolicyMatchInput {
  content?: string | null;
  title?: string | null;
  summary?: string | null;
  alt?: string | null;
  hashtags?: string[];
}

export declare const INTERNAL_SYSTEM_KEYWORD_TERMS: readonly string[];

export declare function matchesInternalSystemKeywordPolicy(input: InternalPolicyMatchInput): boolean;
