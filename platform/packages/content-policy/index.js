/**
 * Semantic harm categories.
 * Each category has a trust weight (how severely we treat a match) and a
 * list of canonical terms that *semantically belong* to that harm domain.
 * Scoring is computed per-category so that co-occurrence of thematically
 * related terms raises confidence — unlike a flat keyword list where every
 * term is equally isolated.
 */
const SEMANTIC_HARM_CATEGORIES = Object.freeze({
  child_safety: {
    weight: 1.0,
    terms: [
      'child porn', 'childporn', 'kiddie porn', 'kiddyporn', 'jailbait',
      'pedo', 'pedophile', 'pedophilia', 'paedophile', 'paedophilia',
      'toddlercon', 'babyfucker', 'minor sex', 'underage sex', 'underage porn',
      'lolicon', 'loli', 'lollicon', 'lolli', 'shotacon', 'shota con', 'futacon', 'futa con',
    ],
  },
  hate_speech: {
    weight: 0.95,
    terms: [
      'nigger', 'niggers', "n's", 'niggerz', 'niggersz', 'n1gger', 'n1ggers', 'n1ggerz', 'n1gg3r', 'n1gg3rz', 'n!ggaz',
      'kike', 'k1ke', 'kyke', 'jew rat', 'jewrat', 'jewish conspiracy', 'juden', 'untermensch',
      'spic', 'wetback', 'beaner',
      'chink', 'gook', 'zipperhead', 'slope',
      'towelhead', 'raghead', 'sandnigger', 'sand nigger', 'camel jockey',
      'redskin',
      'gas the', 'heil hitler',
    ],
  },
  identity_attack: {
    weight: 0.85,
    terms: [
      'faggot', 'f4ggot', 'fagg0t',
      'tranny', 'trannies',
      'betacuck', 'cuck', 'cuckold',
      'mangina',
    ],
  },
  self_harm: {
    weight: 0.9,
    terms: [
      'kill yourself', 'kys', 'go die', 'neck yourself', 'rope yourself',
      'unalive yourself', 'drink bleach', 'slit your wrists', 'cut yourself', 'die in a fire',
    ],
  },
  sexual_content: {
    weight: 0.8,
    terms: [
      'girlcock', 'girl cock', 'boypussy', 'boy pussy', 'furry sex', 'trans sex',
      'suck my dick', 'suckmydick', 'suckmycock', 'suck my cock', 'suckmypenis', 'suck my penis',
      'lick my clit', 'lickmyclit', 'eat my ass', 'eatmyass',
      'cum', 'cumslut', 'cum slut', 'cumstain', 'cum stain', 'cumshot', 'cum shot',
      'creampie', 'pegging', 'futa', 'scat', 'scat porn', 'scatporn',
      'porn', 'pornography', 'pornographic', 'xxx',
      'boi pucci', 'boipucci',
      'gangbang', 'gang bang', 'deepthroat', 'deep throat', 'blowjob', 'blow job', 'handjob', 'hand job',
      'cock sucking', 'cocksucking', 'pussy licking', 'pussylicking',
      'jizz', 'squirt porn', 'squirtporn', 'camgirl', 'cam girl',
    ],
  },
  incest: {
    weight: 0.9,
    terms: [
      'sib cest', 'sibcest', 'incest',
    ],
  },
});

// Flat list retained for fuzzy matching — derived from all categories.
const RAW_INTERNAL_SYSTEM_KEYWORD_TERMS = Object.values(SEMANTIC_HARM_CATEGORIES)
  .flatMap(({ terms }) => terms);

const INTERNAL_SYSTEM_POLICY_VERSION = 'internal-keyword-v1';
const INTERNAL_SYSTEM_KEYWORD_REASON = 'keyword_extreme_harm';
const INTERNAL_SYSTEM_SCORE_THRESHOLD = 0.75;

const TAGR_REASON_PREFIX_MAP = new Map([
  ['ns', 'sexual_content'],
  ['pn', 'nudity'],
  ['il', 'illegal_content'],
  ['vi', 'violence'],
  ['sp', 'spam'],
  ['nw', 'nsfw'],
  ['im', 'impersonation'],
  ['ih', 'identity_hate'],
  ['cl', 'child_safety'],
  ['hc', 'harassment'],
  ['na', 'unsafe_content'],
]);

const TAGR_REASON_EXACT_MAP = new Map([
  ['report', 'community_report'],
  ['label', 'community_label'],
  ['spam', 'spam'],
  ['scam', 'scam'],
  ['impersonation', 'impersonation'],
  ['harassment', 'harassment'],
  ['hate', 'identity_hate'],
  ['identity_hate', 'identity_hate'],
  ['violence', 'violence'],
  ['threat', 'threat'],
  ['nsfw', 'nsfw'],
]);

const HOMOGLYPH_MAP = new Map([
  ['а', 'a'], ['Α', 'a'], ['а', 'a'], ['ᴀ', 'a'],
  ['е', 'e'], ['Ε', 'e'], ['е', 'e'], ['℮', 'e'],
  ['і', 'i'], ['Ι', 'i'], ['ı', 'i'], ['ⅼ', 'l'],
  ['ο', 'o'], ['Ο', 'o'], ['о', 'o'], ['0', 'o'],
  ['р', 'p'], ['Ρ', 'p'], ['р', 'p'],
  ['с', 'c'], ['С', 'c'], ['с', 'c'],
  ['у', 'y'], ['Υ', 'y'], ['у', 'y'],
  ['х', 'x'], ['Χ', 'x'], ['х', 'x'],
  ['ԁ', 'd'], ['ժ', 'd'],
  ['ԍ', 'g'], ['ɢ', 'g'],
  ['ᴋ', 'k'], ['κ', 'k'],
  ['ｍ', 'm'], ['Μ', 'm'],
  ['ո', 'n'], ['Ν', 'n'],
  ['ѕ', 's'], ['Ｓ', 's'],
  ['ｔ', 't'], ['Τ', 't'],
  ['ᴜ', 'u'],
  ['ᴠ', 'v'],
  ['ᴡ', 'w'],
  ['ᴢ', 'z'],
]);

const LEET_MAP = new Map([
  ['0', 'o'],
  ['1', 'i'],
  ['!', 'i'],
  ['3', 'e'],
  ['4', 'a'],
  ['5', 's'],
  ['7', 't'],
  ['8', 'b'],
  ['9', 'g'],
  ['@', 'a'],
  ['$', 's'],
  ['+', 't'],
]);

const DEFAULT_BAD_DOMAINS = Object.freeze([
  'grabify.link',
  'iplogger.org',
  '2no.co',
  'yip.su',
]);

const RUNTIME_ENV = typeof process !== 'undefined' && process && process.env
  ? process.env
  : {};

const BAD_DOMAIN_SET = new Set([
  ...DEFAULT_BAD_DOMAINS,
  ...String(RUNTIME_ENV.INTERNAL_SYSTEM_BAD_DOMAINS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
]);

const SUSPICIOUS_TLDS = new Set(['zip', 'mov', 'cam', 'gq', 'xyz', 'click']);

function mapWithTable(value, table) {
  let out = '';
  for (const char of value) {
    out += table.get(char) || char;
  }
  return out;
}

function normalize(value) {
  const source = typeof value === 'string' ? value : '';
  const lower = source.toLowerCase().trim();
  const deaccented = lower.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const homoglyphFolded = mapWithTable(deaccented, HOMOGLYPH_MAP);
  const leetFolded = mapWithTable(homoglyphFolded, LEET_MAP);

  return leetFolded
    .replace(/[^a-z0-9:/._\-\s#]/g, ' ')
    .replace(/[_\-]{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalTerm(term) {
  return normalize(term).replace(/^#/, '').replace(/\s+/g, ' ');
}

function buildTermSet() {
  const out = new Set();
  for (const term of RAW_INTERNAL_SYSTEM_KEYWORD_TERMS) {
    const canonical = canonicalTerm(term);
    if (!canonical) continue;
    out.add(canonical);
    out.add(`#${canonical}`);
  }
  return out;
}

const INTERNAL_SYSTEM_KEYWORD_TERMS = Object.freeze([...buildTermSet()]);

const SINGLE_TOKEN_TERMS = Object.freeze(
  INTERNAL_SYSTEM_KEYWORD_TERMS
    .map((term) => canonicalTerm(term).replace(/^#/, ''))
    .filter((term) => term && !term.includes(' ')),
);

function normalizeModerationReason(reason, source = 'external') {
  const rawInput = typeof reason === 'string' ? reason.trim() : '';
  const rawLower = rawInput.toLowerCase().replace(/^tagr:/, '');

  if (source === 'keyword') {
    return INTERNAL_SYSTEM_KEYWORD_REASON;
  }

  if (rawLower.startsWith('mod>')) {
    return normalizeModerationReason(rawLower.slice(4), source);
  }

  const normalized = normalize(rawLower);
  if (!normalized) return 'unsafe_content';

  if (TAGR_REASON_EXACT_MAP.has(normalized)) {
    return TAGR_REASON_EXACT_MAP.get(normalized);
  }

  if (/^[a-z]{2}(?:-[a-z]{3})?$/.test(normalized)) {
    const prefix = normalized.slice(0, 2);
    return TAGR_REASON_PREFIX_MAP.get(prefix) || 'unsafe_content';
  }

  return normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unsafe_content';
}

function uniqueNormalizedHashtags(hashtags) {
  const out = new Set();
  for (const hashtag of hashtags || []) {
    if (typeof hashtag !== 'string') continue;
    const normalized = normalize(hashtag).replace(/^#/, '');
    if (!normalized) continue;
    out.add(normalized);
  }
  return out;
}

function containsWholeWord(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'iu');
  return pattern.test(text);
}

function textMatchesTerm(normalizedText, canonical) {
  if (!canonical) return false;

  const compact = canonical.replace(/^#/, '');
  if (!compact) return false;

  if (compact.includes(' ')) {
    return normalizedText.includes(compact);
  }

  return containsWholeWord(normalizedText, compact);
}

function hashtagsMatchTerm(normalizedHashtags, canonical) {
  const compact = canonical.replace(/^#/, '');
  if (!compact) return false;
  return normalizedHashtags.has(compact);
}

function levenshteinDistanceWithin(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return false;
  if (a === b) return true;

  const dp = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) dp[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];

    for (let j = 1; j <= b.length; j += 1) {
      const old = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + cost,
      );
      prev = old;
      if (dp[j] < rowMin) rowMin = dp[j];
    }

    if (rowMin > limit) return false;
  }

  return dp[b.length] <= limit;
}

function extractNormalizedTokens(text) {
  if (!text) return [];
  return text
    .split(/[^a-z0-9#]+/)
    .map((token) => token.replace(/^#/, '').trim())
    .filter((token) => token.length >= 3);
}

function fuzzyMatchesTerms(normalizedText) {
  const tokens = [...new Set(extractNormalizedTokens(normalizedText))];
  if (tokens.length === 0) return [];

  const hits = [];
  for (const term of SINGLE_TOKEN_TERMS) {
    if (term.length < 4) continue;

    const limit = term.length >= 7 ? 2 : 1;
    for (const token of tokens) {
      if (token === term) continue;
      if (!levenshteinDistanceWithin(token, term, limit)) continue;
      hits.push(term);
      break;
    }
  }

  return hits;
}

function extractDomains(text) {
  const matches = text.match(/\b(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi) || [];
  const out = new Set();

  for (const raw of matches) {
    const normalized = raw
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .trim()
      .toLowerCase();

    if (!normalized || !normalized.includes('.')) continue;
    out.add(normalized);
  }

  return [...out];
}

function analyzeDomainReputation(domains) {
  const matchedDomains = [];
  for (const domain of domains) {
    const parts = domain.split('.');
    const tld = parts[parts.length - 1] || '';

    if (BAD_DOMAIN_SET.has(domain) || [...BAD_DOMAIN_SET].some((candidate) => domain.endsWith(`.${candidate}`))) {
      matchedDomains.push(domain);
      continue;
    }

    if (SUSPICIOUS_TLDS.has(tld)) {
      matchedDomains.push(domain);
    }
  }

  return matchedDomains;
}

/**
 * Build a pre-indexed map of canonical term → category name for O(1) lookups.
 * A term may belong to exactly one category (first-wins if duplicated).
 */
const TERM_TO_CATEGORY = (() => {
  const map = new Map();
  for (const [category, { terms }] of Object.entries(SEMANTIC_HARM_CATEGORIES)) {
    for (const term of terms) {
      const c = canonicalTerm(term);
      if (c && !map.has(c)) map.set(c, category);
      if (c && !map.has(`#${c}`)) map.set(`#${c}`, category);
    }
  }
  return map;
})();

/**
 * Semantic keyword matching.
 *
 * Rather than treating every keyword as equally isolated, we:
 *   1. Score each semantic harm category independently by counting how many
 *      of its terms appear in the content (exact text + hashtag + fuzzy).
 *   2. Weight each category hit by its category weight × signal strength
 *      (exact > hashtag > fuzzy), then normalise to [0, 1] within the category.
 *   3. The overall risk score is the maximum weighted category score, so
 *      co-occurrence of semantically related terms *coherently boosts* the
 *      category confidence rather than accumulating a generic counter.
 *   4. Domain reputation is scored independently and can also push the result
 *      above threshold on its own.
 *
 * @param {InternalPolicyMatchInput} input
 * @returns {InternalModerationRiskResult}
 */
function scoreInternalModerationRisk(input) {
  const text = [input.title, input.summary, input.alt, input.content]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
  const normalizedText = normalize(text);
  const normalizedHashtags = uniqueNormalizedHashtags(input.hashtags || []);

  // Per-category accumulators: { hits, signalSum }
  // signalSum collects weighted signal values per matched term.
  const categoryAccumulators = {};
  for (const category of Object.keys(SEMANTIC_HARM_CATEGORIES)) {
    categoryAccumulators[category] = { hits: 0, signalSum: 0 };
  }

  const allMatchedTerms = new Set();

  // --- Pass 1: exact text matches (highest signal) ---
  for (const term of INTERNAL_SYSTEM_KEYWORD_TERMS) {
    const canonical = canonicalTerm(term);
    if (!canonical) continue;

    if (normalizedText && textMatchesTerm(normalizedText, canonical)) {
      const bare = canonical.replace(/^#/, '');
      allMatchedTerms.add(bare);
      const category = TERM_TO_CATEGORY.get(canonical) || TERM_TO_CATEGORY.get(`#${canonical}`);
      if (category) {
        categoryAccumulators[category].hits += 1;
        categoryAccumulators[category].signalSum += 1.0; // exact match signal
      }
    }
  }

  // --- Pass 2: hashtag matches (strong signal, likely intentional tagging) ---
  for (const term of INTERNAL_SYSTEM_KEYWORD_TERMS) {
    const canonical = canonicalTerm(term);
    if (!canonical) continue;

    if (normalizedHashtags.size > 0 && hashtagsMatchTerm(normalizedHashtags, canonical)) {
      const bare = canonical.replace(/^#/, '');
      allMatchedTerms.add(bare);
      const category = TERM_TO_CATEGORY.get(canonical) || TERM_TO_CATEGORY.get(`#${canonical}`);
      if (category) {
        categoryAccumulators[category].hits += 1;
        categoryAccumulators[category].signalSum += 0.9; // hashtag signal
      }
    }
  }

  // --- Pass 3: fuzzy matches (lower signal, evasion detection) ---
  const fuzzyHits = fuzzyMatchesTerms(normalizedText);
  for (const hit of fuzzyHits) {
    allMatchedTerms.add(hit);
    const category = TERM_TO_CATEGORY.get(hit) || TERM_TO_CATEGORY.get(`#${hit}`);
    if (category) {
      categoryAccumulators[category].hits += 1;
      categoryAccumulators[category].signalSum += 0.55; // fuzzy signal
    }
  }

  // --- Compute per-category semantic confidence scores ---
  // confidence = min(1, signalSum * categoryWeight)
  // Diminishing returns: each additional hit adds less than the first.
  const categoryScores = {};
  let maxCategoryScore = 0;
  let topCategory = null;

  for (const [category, { weight }] of Object.entries(SEMANTIC_HARM_CATEGORIES)) {
    const acc = categoryAccumulators[category];
    if (acc.hits === 0) {
      categoryScores[category] = 0;
      continue;
    }
    // Diminishing returns: log-scale over hit count, capped at 1.
    const rawConfidence = Math.min(1, acc.signalSum * weight * (1 + Math.log(acc.hits) * 0.3));
    categoryScores[category] = Math.round(rawConfidence * 1000) / 1000;

    if (categoryScores[category] > maxCategoryScore) {
      maxCategoryScore = categoryScores[category];
      topCategory = category;
    }
  }

  // --- Domain reputation (independent signal) ---
  const matchedDomains = analyzeDomainReputation(extractDomains(normalizedText));
  const domainScore = matchedDomains.length > 0 ? 0.8 : 0;

  const score = Math.min(1, Math.max(maxCategoryScore, domainScore));

  const flags = [];
  if (allMatchedTerms.size > 0) flags.push('semantic_category_match');
  if (fuzzyHits.length > 0) flags.push('fuzzy_term_match');
  if (matchedDomains.length > 0) flags.push('domain_reputation_match');

  return {
    score,
    threshold: INTERNAL_SYSTEM_SCORE_THRESHOLD,
    topCategory,
    categoryScores,
    matchedTerms: [...allMatchedTerms],
    matchedDomains,
    flags,
    normalizedText,
  };
}

function matchesInternalSystemKeywordPolicy(input) {
  const risk = scoreInternalModerationRisk(input);
  return risk.score >= risk.threshold;
}

export {
  INTERNAL_SYSTEM_POLICY_VERSION,
  INTERNAL_SYSTEM_KEYWORD_REASON,
  INTERNAL_SYSTEM_KEYWORD_TERMS,
  matchesInternalSystemKeywordPolicy,
  normalizeModerationReason,
  scoreInternalModerationRisk,
};
