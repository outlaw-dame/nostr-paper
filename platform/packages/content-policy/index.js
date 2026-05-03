const RAW_INTERNAL_SYSTEM_KEYWORD_TERMS = [
  'nigger', 'niggers', "n's", 'niggerz', 'niggersz', 'n1gger', 'n1ggers', 'n1ggerz', 'n1gg3r', 'n1gg3rz', 'n!ggaz',
  'kike', 'k1ke', 'kyke', 'jew rat', 'jewrat', 'jewish conspiracy', 'juden', 'untermensch',
  'spic', 'wetback', 'beaner',
  'chink', 'gook', 'zipperhead', 'slope',
  'towelhead', 'raghead', 'sandnigger', 'sand nigger', 'camel jockey',
  'redskin',
  'faggot', 'f4ggot', 'fagg0t',
  'tranny', 'trannies',
  'gas the', 'heil hitler',
  'kill yourself', 'kys', 'go die', 'neck yourself', 'rope yourself', 'unalive yourself', 'drink bleach', 'slit your wrists', 'cut yourself', 'die in a fire',
  'betacuck', 'cuck', 'cuckold',
  'girlcock', 'girl cock', 'boypussy', 'boy pussy', 'mangina', 'furry sex', 'trans sex',
  'suck my dick', 'suckmydick', 'suckmycock', 'suck my cock', 'suckmypenis', 'suck my penis',
  'lick my clit', 'lickmyclit', 'eat my ass', 'eatmyass', 'eastmyass',
  'cum', 'cumslut', 'cum slut', 'cumstain', 'cumstainm', 'cum stain', 'cumshot', 'cum shot',
  'creampie', 'pegging', 'futa', 'scat', 'scat porn', 'scatporn', 'porn', 'pornography', 'pornographic', 'xxx',
  'marathi', 'boi pucci', 'boipucci',
  'gangbang', 'gang bang', 'deepthroat', 'deep throat', 'blowjob', 'blow job', 'handjob', 'hand job',
  'cock sucking', 'cocksucking', 'pussy licking', 'pussylicking', 'jizz', 'squirt porn', 'squirtporn', 'camgirl', 'cam girl',
  'child porn', 'childporn', 'kiddie porn', 'kiddyporn', 'jailbait', 'pedo', 'pedophile', 'pedophilia', 'paedophile', 'paedophilia',
  'toddlercon', 'babyfucker', 'minor sex', 'underage sex', 'underage porn',
  'lolicon', 'loli', 'lollicon', 'lolli', 'shotacon', 'shota con', 'futacon', 'futa con',
  'sib cest', 'sibcest', 'incest',
];

const INTERNAL_SYSTEM_POLICY_VERSION = 'internal-keyword-v1';
const INTERNAL_SYSTEM_KEYWORD_REASON = 'keyword_extreme_harm';

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

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
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

function normalizeModerationReason(reason, source = 'external') {
  const normalized = normalize(typeof reason === 'string' ? reason : '').replace(/^tagr:/, '');

  if (source === 'keyword') {
    return INTERNAL_SYSTEM_KEYWORD_REASON;
  }

  if (!normalized) return 'unsafe_content';

  if (TAGR_REASON_EXACT_MAP.has(normalized)) {
    return TAGR_REASON_EXACT_MAP.get(normalized);
  }

  if (/^[a-z]{2}(?:-[a-z]{3})?$/.test(normalized)) {
    const prefix = normalized.slice(0, 2);
    return TAGR_REASON_PREFIX_MAP.get(prefix) || 'unsafe_content';
  }

  if (normalized.startsWith('mod>')) {
    return normalizeModerationReason(normalized.slice(4), source);
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

function matchesInternalSystemKeywordPolicy(input) {
  const text = [input.title, input.summary, input.alt, input.content]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
  const normalizedText = normalize(text);
  const normalizedHashtags = uniqueNormalizedHashtags(input.hashtags || []);

  for (const term of INTERNAL_SYSTEM_KEYWORD_TERMS) {
    const canonical = canonicalTerm(term);
    if (!canonical) continue;

    if (normalizedText && textMatchesTerm(normalizedText, canonical)) {
      return true;
    }

    if (normalizedHashtags.size > 0 && hashtagsMatchTerm(normalizedHashtags, canonical)) {
      return true;
    }
  }

  return false;
}

export {
  INTERNAL_SYSTEM_POLICY_VERSION,
  INTERNAL_SYSTEM_KEYWORD_REASON,
  INTERNAL_SYSTEM_KEYWORD_TERMS,
  matchesInternalSystemKeywordPolicy,
  normalizeModerationReason,
};
