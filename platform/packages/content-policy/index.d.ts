export interface InternalPolicyMatchInput {
  content?: string | null;
  title?: string | null;
  summary?: string | null;
  alt?: string | null;
  hashtags?: string[];
}

export type SemanticHarmCategory =
  | 'child_safety'
  | 'hate_speech'
  | 'identity_attack'
  | 'self_harm'
  | 'sexual_content'
  | 'incest';

export interface InternalPolicyRiskScore {
  /** Overall risk score in [0, 1]. Exceeds threshold when content should be blocked. */
  score: number;
  threshold: number;
  /** The semantic harm category with the highest confidence score, if any. */
  topCategory: SemanticHarmCategory | null;
  /** Per-category semantic confidence scores in [0, 1]. */
  categoryScores: Record<SemanticHarmCategory, number>;
  matchedTerms: string[];
  matchedDomains: string[];
  /** Signal flags: 'semantic_category_match' | 'fuzzy_term_match' | 'domain_reputation_match' */
  flags: string[];
  normalizedText: string;
}

/** @deprecated Use InternalPolicyRiskScore */
export type InternalModerationRiskResult = InternalPolicyRiskScore;

export declare const INTERNAL_SYSTEM_POLICY_VERSION: 'internal-keyword-v1';
export declare const INTERNAL_SYSTEM_KEYWORD_REASON: 'keyword_extreme_harm';
export declare const INTERNAL_SYSTEM_KEYWORD_TERMS: readonly string[];

export declare function scoreInternalModerationRisk(input: InternalPolicyMatchInput): InternalPolicyRiskScore;
export declare function matchesInternalSystemKeywordPolicy(input: InternalPolicyMatchInput): boolean;
export declare function normalizeModerationReason(reason: string, source?: 'keyword' | 'tagr' | 'external'): string;
