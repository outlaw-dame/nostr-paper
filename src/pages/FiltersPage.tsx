/**
 * FiltersPage  (/filters)
 *
 * Full keyword-filter management UI.
 *
 * Sections:
 *   1. Active filters — list with toggle, edit, delete
 *   2. Add / edit form — inline, with live preview of which fields will
 *      be checked and whether semantic matching is enabled
 *   3. How it works — compact explainer for semantic matching
 *
 * Design goals:
 *   • Significantly beyond Mastodon: expiry dates, scope control, semantic
 *     toggle, per-match field attribution
 *   • iOS-style native-div layout (same as ProfilePage rewrite — no Konsta)
 *   • All state is local; IndexedDB sync is handled by useKeywordFilters
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useKeywordFilters } from '@/hooks/useKeywordFilters'
import type { CreateFilterInput, FilterAction, FilterScope, KeywordFilter } from '@/lib/filters/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const SCOPE_LABELS: Record<FilterScope, string> = {
  any:     'Everywhere',
  content: 'Content only',
  author:  'Author only',
  hashtag: 'Hashtags only',
}

const SCOPE_DESCRIPTIONS: Record<FilterScope, string> = {
  any:     'Note body, title, summary, poll options, hashtags, author name, bio, and NIP-05 ID',
  content: 'Note body, article title/summary, poll options, and hashtags',
  author:  'Author display name, username, bio, and NIP-05 identifier',
  hashtag: '#t tags only (exact normalised match)',
}

const ACTION_LABELS: Record<FilterAction, string> = {
  hide: 'Hide',
  warn: 'Warn',
}

// ── Blank form state ──────────────────────────────────────────────────────────

function blankForm(): Omit<CreateFilterInput, 'createdAt'> {
  return {
    term:      '',
    action:    'warn',
    scope:     'any',
    wholeWord: false,
    semantic:  true,
    enabled:   true,
    expiresAt: null,
  }
}

// ── Expiry helpers ────────────────────────────────────────────────────────────

const EXPIRY_PRESETS = [
  { label: 'Never',    value: null        },
  { label: '24 hours', value: 24 * 60 * 60 * 1_000  },
  { label: '7 days',   value: 7  * 24 * 60 * 60 * 1_000 },
  { label: '30 days',  value: 30 * 24 * 60 * 60 * 1_000 },
]

function presetToExpiry(ms: number | null): number | null {
  if (ms === null) return null
  return Date.now() + ms
}

function formatExpiry(ts: number): string {
  const diff = ts - Date.now()
  if (diff <= 0) return 'Expired'
  const days = Math.floor(diff / (24 * 60 * 60 * 1_000))
  if (days > 0) return `${days}d left`
  const hrs  = Math.floor(diff / (60 * 60 * 1_000))
  if (hrs  > 0) return `${hrs}h left`
  return 'Expiring soon'
}

// ── FilterRow ─────────────────────────────────────────────────────────────────

interface FilterRowProps {
  filter:   KeywordFilter
  onToggle: (id: string) => void
  onEdit:   (filter: KeywordFilter) => void
  onDelete: (id: string) => void
}

function FilterRow({ filter, onToggle, onEdit, onDelete }: FilterRowProps) {
  const isExpired = filter.expiresAt !== null && filter.expiresAt < Date.now()

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{    opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className={`
        flex items-start gap-3 px-4 py-3.5
        ${isExpired ? 'opacity-50' : ''}
      `}
    >
      {/* Toggle */}
      <button
        type="button"
        role="switch"
        aria-checked={filter.enabled && !isExpired}
        onClick={() => onToggle(filter.id)}
        className="
          mt-0.5 shrink-0 w-11 h-6 rounded-full
          transition-colors duration-200
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]
        "
        style={{
          backgroundColor: filter.enabled && !isExpired
            ? 'rgb(var(--color-system-green))'
            : 'rgb(var(--color-fill-secondary) / 0.3)',
        }}
        aria-label={`${filter.enabled ? 'Disable' : 'Enable'} filter for "${filter.term}"`}
      >
        <motion.span
          layout
          className="block w-5 h-5 rounded-full bg-white shadow-sm"
          animate={{ x: filter.enabled && !isExpired ? '22px' : '2px' }}
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        />
      </button>

      {/* Content */}
      <button
        type="button"
        onClick={() => onEdit(filter)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-medium text-[rgb(var(--color-label))] truncate">
            {filter.term}
          </span>

          {/* Action badge */}
          <span
            className="
              text-[11px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide
            "
            style={{
              backgroundColor: filter.action === 'hide'
                ? 'rgb(var(--color-system-red) / 0.12)'
                : 'rgb(var(--color-system-yellow) / 0.15)',
              color: filter.action === 'hide'
                ? 'rgb(var(--color-system-red))'
                : 'rgb(160 120 0)',
            }}
          >
            {ACTION_LABELS[filter.action]}
          </span>

          {/* Semantic badge */}
          {filter.semantic && (
            <span className="
              text-[11px] font-medium px-1.5 py-0.5 rounded-full
              bg-[rgb(var(--color-system-purple)/0.12)]
              text-[rgb(var(--color-system-purple))]
            ">
              semantic
            </span>
          )}
        </div>

        <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-0.5">
          {SCOPE_LABELS[filter.scope]}
          {filter.wholeWord && ' · whole word'}
          {filter.expiresAt !== null && (
            <>
              {' · '}
              <span className={filter.expiresAt < Date.now() ? 'text-[rgb(var(--color-system-red))]' : ''}>
                {formatExpiry(filter.expiresAt)}
              </span>
            </>
          )}
        </p>
      </button>

      {/* Delete */}
      <button
        type="button"
        onClick={() => onDelete(filter.id)}
        className="
          shrink-0 mt-0.5 w-7 h-7 flex items-center justify-center
          rounded-full
          text-[rgb(var(--color-system-red))]
          bg-[rgb(var(--color-system-red)/0.08)]
          active:opacity-60
          transition-opacity
        "
        aria-label={`Delete filter for "${filter.term}"`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        </svg>
      </button>
    </motion.div>
  )
}

// ── AddEditForm ───────────────────────────────────────────────────────────────

interface FormState {
  term:         string
  action:       FilterAction
  scope:        FilterScope
  wholeWord:    boolean
  semantic:     boolean
  expiryPreset: number | null   // ms offset, null = never
}

interface AddEditFormProps {
  initial:    Partial<FormState> & { id?: string }
  onSave:     (data: CreateFilterInput, id?: string) => void
  onCancel:   () => void
  saving:     boolean
}

function AddEditForm({ initial, onSave, onCancel, saving }: AddEditFormProps) {
  const [form, setForm] = useState<FormState>({
    term:         initial.term         ?? '',
    action:       initial.action       ?? 'warn',
    scope:        initial.scope        ?? 'any',
    wholeWord:    initial.wholeWord    ?? false,
    semantic:     initial.semantic     ?? true,
    expiryPreset: initial.expiryPreset ?? null,
  })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const termTrimmed = form.term.trim()
  const canSave     = termTrimmed.length > 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return
    onSave(
      {
        term:      termTrimmed,
        action:    form.action,
        scope:     form.scope,
        wholeWord: form.wholeWord,
        semantic:  form.semantic,
        enabled:   true,
        expiresAt: presetToExpiry(form.expiryPreset),
      },
      initial.id,
    )
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-2 pt-3 space-y-4">

      {/* Term input */}
      <div>
        <label
          htmlFor="filter-term"
          className="block text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-1.5"
        >
          Keyword, phrase, or #hashtag
        </label>
        <input
          id="filter-term"
          ref={inputRef}
          type="text"
          value={form.term}
          onChange={e => set('term', e.target.value)}
          placeholder="e.g. violence, #politics, crypto scam"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="
            w-full h-11 px-3.5
            rounded-[10px]
            bg-[rgb(var(--color-fill)/0.08)]
            text-[15px] text-[rgb(var(--color-label))]
            placeholder:text-[rgb(var(--color-label-tertiary))]
            focus:outline-none focus:ring-2 focus:ring-[#007AFF]
          "
        />
        {termTrimmed.startsWith('#') && (
          <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-1">
            Hashtag mode — exact match against #t tags (case-insensitive)
          </p>
        )}
      </div>

      {/* Action + Scope row */}
      <div className="grid grid-cols-2 gap-3">

        {/* Action */}
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-1.5">
            Action
          </p>
          <div className="flex rounded-[10px] overflow-hidden bg-[rgb(var(--color-fill)/0.08)]">
            {(['warn', 'hide'] as FilterAction[]).map(a => (
              <button
                key={a}
                type="button"
                onClick={() => set('action', a)}
                className={`
                  flex-1 py-2 text-[13px] font-medium transition-colors duration-150
                  ${form.action === a
                    ? a === 'hide'
                      ? 'bg-[rgb(var(--color-system-red))] text-white'
                      : 'bg-[rgb(var(--color-system-yellow)/0.90)] text-black'
                    : 'text-[rgb(var(--color-label-secondary))]'
                  }
                `}
              >
                {ACTION_LABELS[a]}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[rgb(var(--color-label-tertiary))] mt-1">
            {form.action === 'hide' ? 'Remove from feed' : 'Collapse with reveal'}
          </p>
        </div>

        {/* Expiry */}
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-1.5">
            Expires
          </p>
          <select
            value={form.expiryPreset === null ? 'null' : String(form.expiryPreset)}
            onChange={e => set('expiryPreset', e.target.value === 'null' ? null : Number(e.target.value))}
            className="
              w-full h-9 px-2 rounded-[10px]
              bg-[rgb(var(--color-fill)/0.08)]
              text-[13px] text-[rgb(var(--color-label))]
              focus:outline-none focus:ring-2 focus:ring-[#007AFF]
              appearance-none
            "
          >
            {EXPIRY_PRESETS.map(p => (
              <option key={String(p.value)} value={p.value === null ? 'null' : String(p.value)}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Scope */}
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-1.5">
          Apply to
        </p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SCOPE_LABELS) as FilterScope[]).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => set('scope', s)}
              className={`
                px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors duration-150
                ${form.scope === s
                  ? 'bg-[#007AFF] text-white'
                  : 'bg-[rgb(var(--color-fill)/0.09)] text-[rgb(var(--color-label-secondary))]'
                }
              `}
            >
              {SCOPE_LABELS[s]}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-1.5 leading-relaxed">
          {SCOPE_DESCRIPTIONS[form.scope]}
        </p>
      </div>

      {/* Toggles */}
      <div className="space-y-3">
        {/* Whole word */}
        <label className="flex items-start gap-3">
          <div className="mt-0.5 flex-1">
            <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
              Whole word
            </p>
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-0.5">
              Requires word boundaries — &ldquo;ass&rdquo; won&apos;t match &ldquo;class&rdquo;
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.wholeWord}
            onClick={() => set('wholeWord', !form.wholeWord)}
            className="
              shrink-0 mt-0.5 w-11 h-6 rounded-full
              transition-colors duration-200
            "
            style={{
              backgroundColor: form.wholeWord
                ? 'rgb(var(--color-system-green))'
                : 'rgb(var(--color-fill-secondary) / 0.3)',
            }}
          >
            <motion.span
              layout
              className="block w-5 h-5 rounded-full bg-white shadow-sm"
              animate={{ x: form.wholeWord ? '22px' : '2px' }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          </button>
        </label>

        {/* Semantic */}
        <label className="flex items-start gap-3">
          <div className="mt-0.5 flex-1">
            <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
              Semantic matching
              <span className="
                ml-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full
                bg-[rgb(var(--color-system-purple)/0.12)]
                text-[rgb(var(--color-system-purple))]
              ">
                AI
              </span>
            </p>
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-0.5">
              Also matches related concepts — &ldquo;violence&rdquo; catches &ldquo;assault&rdquo;,
              &ldquo;shooting&rdquo;, &ldquo;conflict&rdquo;. Uses the on-device embedding model.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.semantic}
            onClick={() => set('semantic', !form.semantic)}
            className="
              shrink-0 mt-0.5 w-11 h-6 rounded-full
              transition-colors duration-200
            "
            style={{
              backgroundColor: form.semantic
                ? 'rgb(var(--color-system-purple))'
                : 'rgb(var(--color-fill-secondary) / 0.3)',
            }}
          >
            <motion.span
              layout
              className="block w-5 h-5 rounded-full bg-white shadow-sm"
              animate={{ x: form.semantic ? '22px' : '2px' }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          </button>
        </label>
      </div>

      {/* Scope preview */}
      <div className="
        rounded-[10px] px-3.5 py-2.5
        bg-[rgb(var(--color-fill)/0.06)]
        border border-[rgb(var(--color-fill)/0.08)]
      ">
        <p className="text-[12px] text-[rgb(var(--color-label-secondary))] leading-relaxed">
          <span className="font-semibold text-[rgb(var(--color-label))]">Will check: </span>
          {form.scope === 'any' && (
            <>note body, article title/summary, poll options, hashtags, author name/bio/NIP-05</>
          )}
          {form.scope === 'content' && (
            <>note body, article title/summary, poll options, hashtags</>
          )}
          {form.scope === 'author' && (
            <>author display name, username, bio, NIP-05 identifier</>
          )}
          {form.scope === 'hashtag' && (
            <>#hashtag tags only (exact, case-insensitive)</>
          )}
          {form.semantic && (
            <>
              {' '}
              <span className="text-[rgb(var(--color-system-purple))]">
                + semantic embedding similarity
              </span>
            </>
          )}
        </p>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="
            flex-1 h-11 rounded-[12px]
            bg-[rgb(var(--color-fill)/0.08)]
            text-[15px] font-medium text-[rgb(var(--color-label))]
            active:opacity-70 transition-opacity
          "
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSave || saving}
          className="
            flex-[2] h-11 rounded-[12px]
            bg-[#007AFF] text-white
            text-[15px] font-semibold
            disabled:opacity-40
            active:opacity-80 transition-opacity
          "
        >
          {saving ? 'Saving…' : initial.id ? 'Save changes' : 'Add filter'}
        </button>
      </div>
    </form>
  )
}

// ── FiltersPage ───────────────────────────────────────────────────────────────

export default function FiltersPage() {
  const navigate = useNavigate()
  const { filters, loading, add, update, remove, toggle } = useKeywordFilters()

  const [showForm, setShowForm]       = useState(false)
  const [editTarget, setEditTarget]   = useState<KeywordFilter | null>(null)
  const [saving, setSaving]           = useState(false)

  const handleSave = useCallback(async (
    data: CreateFilterInput,
    id?:  string,
  ) => {
    setSaving(true)
    try {
      if (id) {
        await update(id, data)
      } else {
        await add(data)
      }
      setShowForm(false)
      setEditTarget(null)
    } finally {
      setSaving(false)
    }
  }, [add, update])

  const handleEdit = useCallback((filter: KeywordFilter) => {
    setEditTarget(filter)
    setShowForm(true)
  }, [])

  const handleCancel = useCallback(() => {
    setShowForm(false)
    setEditTarget(null)
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    await remove(id)
  }, [remove])

  const handleToggle = useCallback(async (id: string) => {
    await toggle(id)
  }, [toggle])

  const activeCount  = filters.filter(f => f.enabled && (f.expiresAt === null || f.expiresAt > Date.now())).length
  const expiredCount = filters.filter(f => f.expiresAt !== null && f.expiresAt < Date.now()).length

  // Sort: enabled first, then disabled, expired last
  const sorted = [...filters].sort((a, b) => {
    const aExp = a.expiresAt !== null && a.expiresAt < Date.now()
    const bExp = b.expiresAt !== null && b.expiresAt < Date.now()
    if (aExp !== bExp) return aExp ? 1 : -1
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    return a.createdAt - b.createdAt
  })

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))]">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] backdrop-blur-xl py-4 pt-safe">
        <div className="px-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-[#007AFF] active:opacity-60"
          >
            <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true">
              <path d="M7 1L1 7l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[17px]">Settings</span>
          </button>

          <h1 className="text-[17px] font-semibold text-[rgb(var(--color-label))] absolute left-1/2 -translate-x-1/2">
            Content Filters
          </h1>

          {!showForm && (
            <button
              type="button"
              onClick={() => { setEditTarget(null); setShowForm(true) }}
              className="text-[17px] text-[#007AFF] font-medium active:opacity-60"
            >
              Add
            </button>
          )}
        </div>
      </div>

      <div className="px-0 pb-10 pb-safe">

        {/* Summary strip */}
        {!loading && filters.length > 0 && (
          <div className="px-4 pb-3">
            <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
              {activeCount} active filter{activeCount !== 1 ? 's' : ''}
              {expiredCount > 0 && ` · ${expiredCount} expired`}
            </p>
          </div>
        )}

        {/* Add / Edit form */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0  }}
              exit={{    opacity: 0, y: -8 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              className="
                mx-4 mb-4 rounded-ios-2xl
                bg-[rgb(var(--color-bg-secondary))]
                shadow-md
              "
            >
              <div className="px-4 pt-4 pb-2 border-b border-[rgb(var(--color-fill)/0.08)]">
                <h2 className="text-[15px] font-semibold text-[rgb(var(--color-label))]">
                  {editTarget ? `Edit "${editTarget.term}"` : 'New filter'}
                </h2>
              </div>
              <AddEditForm
                initial={editTarget
                  ? {
                      id:           editTarget.id,
                      term:         editTarget.term,
                      action:       editTarget.action,
                      scope:        editTarget.scope,
                      wholeWord:    editTarget.wholeWord,
                      semantic:     editTarget.semantic,
                      expiryPreset: null,   // don't pre-fill preset; user can reset
                    }
                  : {}
                }
                onSave={handleSave}
                onCancel={handleCancel}
                saving={saving}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter list */}
        {loading ? (
          <div className="px-4 space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-14 skeleton rounded-ios-xl" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="px-4 pt-8 pb-4 text-center"
          >
            <p className="text-[40px] mb-3">🔕</p>
            <p className="text-[17px] font-semibold text-[rgb(var(--color-label))] mb-1">
              No filters yet
            </p>
            <p className="text-[14px] text-[rgb(var(--color-label-secondary))] max-w-xs mx-auto leading-relaxed">
              Add words, phrases, or #hashtags to hide or warn on matching posts, profiles, and bios.
            </p>
          </motion.div>
        ) : (
          <div className="mx-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] overflow-hidden">
            <AnimatePresence initial={false}>
              {sorted.map((filter, i) => (
                <div key={filter.id}>
                  {i > 0 && (
                    <div className="mx-4 h-px bg-[rgb(var(--color-fill)/0.08)]" />
                  )}
                  <FilterRow
                    filter={filter}
                    onToggle={handleToggle}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                </div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* How it works */}
        <div className="mx-4 mt-6 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] px-4 py-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-3">
            How it works
          </p>
          <div className="space-y-3">
            {[
              {
                icon: '🔍',
                title: 'Text matching',
                body: 'Instant, always active. Checks every field — note body, title, poll options, author name, bio, NIP-05 identifier, and hashtags.',
              },
              {
                icon: '🧠',
                title: 'Semantic matching',
                body: 'When enabled, uses an on-device AI model (all-MiniLM-L6-v2) to catch related concepts. "violence" also matches "assault", "shooting", "conflict". Results are cached — each post is embedded once.',
              },
              {
                icon: '⚠️',
                title: 'Warn vs. Hide',
                body: '"Warn" collapses the post with a label; tap to reveal. "Hide" removes it from the feed entirely.',
              },
              {
                icon: '⏱️',
                title: 'Expiry',
                body: 'Set filters to auto-disable after 24 h, 7 days, or 30 days for temporary topics.',
              },
            ].map(item => (
              <div key={item.title} className="flex gap-3">
                <span className="text-[20px] shrink-0 mt-0.5" aria-hidden="true">{item.icon}</span>
                <div>
                  <p className="text-[13px] font-semibold text-[rgb(var(--color-label))]">{item.title}</p>
                  <p className="text-[12px] text-[rgb(var(--color-label-secondary))] mt-0.5 leading-relaxed">
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
