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
import { tApp } from '@/lib/i18n/app'
import { useKeywordFilters } from '@/hooks/useKeywordFilters'
import { SYSTEM_FILTER_GROUPS, SYSTEM_KEYWORD_FILTERS, type SystemFilterGroup } from '@/lib/filters/systemFilters'
import type { CreateFilterInput, FilterAction, FilterScope, KeywordFilter } from '@/lib/filters/types'

// ── Constants ─────────────────────────────────────────────────────────────────

function getScopeLabel(scope: FilterScope): string {
  const map: Record<FilterScope, string> = {
    any:     tApp('filtersScopeAny'),
    content: tApp('filtersScopeContent'),
    author:  tApp('filtersScopeAuthor'),
    hashtag: tApp('filtersScopeHashtag'),
  }
  return map[scope]
}

function getScopeDescription(scope: FilterScope): string {
  const map: Record<FilterScope, string> = {
    any:     tApp('filtersScopeDescAny'),
    content: tApp('filtersScopeDescContent'),
    author:  tApp('filtersScopeDescAuthor'),
    hashtag: tApp('filtersScopeDescHashtag'),
  }
  return map[scope]
}

function getActionLabel(action: FilterAction): string {
  const map: Record<FilterAction, string> = {
    warn:  tApp('filtersActionWarn'),
    hide:  tApp('filtersActionHide'),
    block: tApp('filtersActionBlock'),
  }
  return map[action]
}

function getActionDescription(action: FilterAction): string {
  const map: Record<FilterAction, string> = {
    warn:  tApp('filtersActionDescWarn'),
    hide:  tApp('filtersActionDescHide'),
    block: tApp('filtersActionDescBlock'),
  }
  return map[action]
}

function getExpiryPresets(): Array<{ label: string; value: number | null }> {
  return [
    { label: tApp('filtersExpiryNever'), value: null },
    { label: tApp('filtersExpiry24h'),   value: 24 * 60 * 60 * 1_000 },
    { label: tApp('filtersExpiry7d'),    value: 7  * 24 * 60 * 60 * 1_000 },
    { label: tApp('filtersExpiry30d'),   value: 30 * 24 * 60 * 60 * 1_000 },
  ]
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

function presetToExpiry(ms: number | null): number | null {
  if (ms === null) return null
  return Date.now() + ms
}

function formatExpiry(ts: number): string {
  const diff = ts - Date.now()
  if (diff <= 0) return tApp('filtersExpired')
  const days = Math.floor(diff / (24 * 60 * 60 * 1_000))
  if (days > 0) return tApp('filtersDaysLeft', { days })
  const hrs  = Math.floor(diff / (60 * 60 * 1_000))
  if (hrs  > 0) return tApp('filtersHoursLeft', { hrs })
  return tApp('filtersExpiringSoon')
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
        aria-label={filter.enabled ? tApp('filtersToggleDisable', { term: filter.term }) : tApp('filtersToggleEnable', { term: filter.term })}
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
              backgroundColor: filter.action === 'block'
                ? 'rgb(var(--color-system-red) / 0.18)'
                : filter.action === 'hide'
                  ? 'rgb(var(--color-system-red) / 0.12)'
                  : 'rgb(var(--color-system-yellow) / 0.15)',
              color: filter.action === 'block'
                ? 'rgb(var(--color-system-red))'
                : filter.action === 'hide'
                  ? 'rgb(var(--color-system-red))'
                  : 'rgb(160 120 0)',
            }}
          >
            {getActionLabel(filter.action)}
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
          {getScopeLabel(filter.scope)}
          {filter.wholeWord && tApp('filtersWholeWordChip')}
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
        aria-label={tApp('filtersDeleteAria', { term: filter.term })}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        </svg>
      </button>
    </motion.div>
  )
}

function SystemRuleGroupCard({ group }: { group: SystemFilterGroup }) {
  return (
    <div className="rounded-ios-xl border border-[rgb(var(--color-fill)/0.08)] bg-[rgb(var(--color-bg))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[14px] font-semibold text-[rgb(var(--color-label))]">
              {group.title}
            </h3>
            <span className="rounded-full bg-[rgb(var(--color-system-red)/0.12)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-system-red))]">
              {tApp('filtersSystemBlockBadge')}
            </span>
            <span className="rounded-full bg-[rgb(var(--color-system-purple)/0.10)] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--color-system-purple))]">
              {tApp('filtersSemanticBadge')}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
            {group.description}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[rgb(var(--color-fill)/0.10)] px-2 py-1 text-[11px] font-medium text-[rgb(var(--color-label-secondary))]">
          {group.filters.length}
        </span>
      </div>
    </div>
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
          {tApp('filtersTermLabel')}
        </label>
        <input
          id="filter-term"
          ref={inputRef}
          type="text"
          value={form.term}
          onChange={e => set('term', e.target.value)}
          placeholder={tApp('filtersTermPlaceholder')}
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
            {tApp('filtersHashtagHint')}
          </p>
        )}
      </div>

      {/* Action + Scope row */}
      <div className="grid grid-cols-2 gap-3">

        {/* Action */}
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-1.5">
            {tApp('filtersActionLabel')}
          </p>
          <div className="flex rounded-[10px] overflow-hidden bg-[rgb(var(--color-fill)/0.08)]">
            {(['warn', 'hide', 'block'] as FilterAction[]).map(a => (
              <button
                key={a}
                type="button"
                onClick={() => set('action', a)}
                className={`
                  flex-1 py-2 text-[13px] font-medium transition-colors duration-150
                  ${form.action === a
                    ? a === 'block'
                      ? 'bg-[rgb(var(--color-system-red))] text-white'
                      : a === 'hide'
                        ? 'bg-[rgb(var(--color-system-orange))] text-white'
                        : 'bg-[rgb(var(--color-system-yellow)/0.90)] text-black'
                    : 'text-[rgb(var(--color-label-secondary))]'
                  }
                `}
              >
                {getActionLabel(a)}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[rgb(var(--color-label-tertiary))] mt-1">
            {getActionDescription(form.action)}
          </p>
        </div>

        {/* Expiry */}
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-1.5">
            {tApp('filtersExpiresLabel')}
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
            {getExpiryPresets().map(p => (
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
          {tApp('filtersApplyToLabel')}
        </p>
        <div className="flex flex-wrap gap-2">
          {(['any', 'content', 'author', 'hashtag'] as FilterScope[]).map(s => (
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
              {getScopeLabel(s)}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-1.5 leading-relaxed">
          {getScopeDescription(form.scope)}
        </p>
      </div>

      {/* Toggles */}
      <div className="space-y-3">
        {/* Whole word */}
        <label className="flex items-start gap-3">
          <div className="mt-0.5 flex-1">
            <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
              {tApp('filtersWholeWordLabel')}
            </p>
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-0.5">
              {tApp('filtersWholeWordHint')}
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

        {/* Semantic — not applicable to 'block' (ingest-layer is sync only) */}
        <label className={`flex items-start gap-3 ${form.action === 'block' ? 'opacity-40 pointer-events-none' : ''}`}>
          <div className="mt-0.5 flex-1">
            <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
              {tApp('filtersSemanticLabel')}
              <span className="
                ml-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full
                bg-[rgb(var(--color-system-purple)/0.12)]
                text-[rgb(var(--color-system-purple))]
              ">
                AI
              </span>
            </p>
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-0.5">
              {form.action === 'block'
                ? tApp('filtersSemanticBlockHint')
                : tApp('filtersSemanticHint')}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.action !== 'block' && form.semantic}
            onClick={() => set('semantic', !form.semantic)}
            disabled={form.action === 'block'}
            className="
              shrink-0 mt-0.5 w-11 h-6 rounded-full
              transition-colors duration-200
            "
            style={{
              backgroundColor: form.action !== 'block' && form.semantic
                ? 'rgb(var(--color-system-purple))'
                : 'rgb(var(--color-fill-secondary) / 0.3)',
            }}
          >
            <motion.span
              layout
              className="block w-5 h-5 rounded-full bg-white shadow-sm"
              animate={{ x: form.action !== 'block' && form.semantic ? '22px' : '2px' }}
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
          <span className="font-semibold text-[rgb(var(--color-label))]">{tApp('filtersWillCheckLabel')}</span>
          {form.scope === 'any' && tApp('filtersWillCheckAny')}
          {form.scope === 'content' && tApp('filtersWillCheckContent')}
          {form.scope === 'author' && tApp('filtersWillCheckAuthor')}
          {form.scope === 'hashtag' && tApp('filtersWillCheckHashtag')}
          {form.semantic && form.action !== 'block' && (
            <>
              {' '}
              <span className="text-[rgb(var(--color-system-purple))]">
                {tApp('filtersWillCheckSemantic')}
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
          {tApp('filtersButtonCancel')}
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
          {saving ? tApp('filtersButtonSaving') : initial.id ? tApp('filtersButtonSaveChanges') : tApp('filtersButtonAddFilter')}
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
  const [saveError, setSaveError]     = useState<string | null>(null)
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const systemRuleCount = SYSTEM_KEYWORD_FILTERS.length

  const handleSave = useCallback(async (
    data: CreateFilterInput,
    id?:  string,
  ) => {
    setSaving(true)
    setSaveError(null)
    try {
      if (id) {
        await update(id, data)
        setFlashMessage(tApp('filtersFlashUpdated'))
      } else {
        await add(data)
        setFlashMessage(tApp('filtersFlashAdded'))
      }
      setShowForm(false)
      setEditTarget(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save filter.')
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
    setFlashMessage(tApp('filtersFlashDeleted'))
  }, [remove])

  const handleToggle = useCallback(async (id: string) => {
    await toggle(id)
    setFlashMessage(tApp('filtersFlashUpdated'))
  }, [toggle])

  useEffect(() => {
    if (!flashMessage) return
    const timer = window.setTimeout(() => setFlashMessage(null), 2200)
    return () => window.clearTimeout(timer)
  }, [flashMessage])

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
            onClick={() => navigate('/settings/moderation')}
            className="flex items-center gap-1 text-[#007AFF] active:opacity-60"
          >
            <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true">
              <path d="M7 1L1 7l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[17px]">{tApp('filtersBackToModeration')}</span>
          </button>

          <h1 className="text-[17px] font-semibold text-[rgb(var(--color-label))] absolute left-1/2 -translate-x-1/2">
            {tApp('filtersTitle')}
          </h1>

          {!showForm && (
            <button
              type="button"
              onClick={() => { setEditTarget(null); setShowForm(true) }}
              className="text-[17px] text-[#007AFF] font-medium active:opacity-60"
            >
              {tApp('filtersAdd')}
            </button>
          )}
        </div>
        <p className="px-4 mt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-tertiary))]">
          {tApp('filtersBreadcrumb')}
        </p>
      </div>

      <div className="px-0 pb-[max(40px,_env(safe-area-inset-bottom))]">

        {flashMessage && (
          <div className="mx-4 mb-3 rounded-[12px] border border-[rgb(var(--color-system-green)/0.2)] bg-[rgb(var(--color-system-green)/0.1)] px-3 py-2">
            <p className="text-[12px] font-medium text-[rgb(var(--color-system-green))]">
              {flashMessage}
            </p>
          </div>
        )}

        {/* Summary strip */}
        {!loading && (
          <div className="px-4 pb-3">
            <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
              {activeCount !== 1
                ? tApp('filtersActiveCustomFilters', { count: activeCount })
                : tApp('filtersActiveCustomFilter', { count: activeCount })}
              {expiredCount > 0 && ` ${tApp('filtersExpiredCount', { count: expiredCount })}`}
              {systemRuleCount > 0 && ` ${tApp('filtersSystemRulesAlwaysOn', { count: systemRuleCount })}`}
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
                  {editTarget ? tApp('filtersFormEditTitle', { term: editTarget.term }) : tApp('filtersFormNewTitle')}
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
              {saveError && (
                <p className="px-4 pb-4 text-[12px] text-[rgb(var(--color-system-red))]">
                  {saveError}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Custom filter list */}
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
              {tApp('filtersNoFiltersTitle')}
            </p>
            <p className="text-[14px] text-[rgb(var(--color-label-secondary))] max-w-xs mx-auto leading-relaxed">
              {tApp('filtersNoFiltersHint')}
            </p>
          </motion.div>
        ) : (
          <>
            <div className="px-4 pb-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-tertiary))]">
                {tApp('filtersCustomSection')}
              </p>
            </div>
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
          </>
        )}

        {/* System rules */}
        {!loading && systemRuleCount > 0 && (
          <div className="px-4 pt-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-tertiary))]">
                  {tApp('filtersSystemSection')}
                </p>
                <p className="mt-1 max-w-[38rem] text-[13px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
                  {tApp('filtersSystemHint')}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-[rgb(var(--color-fill)/0.10)] px-2.5 py-1 text-[11px] font-medium text-[rgb(var(--color-label-secondary))]">
                {systemRuleCount}
              </span>
            </div>

            <div className="mt-3 space-y-3">
              {SYSTEM_FILTER_GROUPS.map((group) => (
                <SystemRuleGroupCard key={group.id} group={group} />
              ))}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="mx-4 mt-6 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] px-4 py-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-3">
            {tApp('filtersHowItWorksTitle')}
          </p>
          <div className="space-y-3">
            {[
              {
                icon: '🔍',
                title: tApp('filtersHowItWorksTextTitle'),
                body:  tApp('filtersHowItWorksTextBody'),
              },
              {
                icon: '🧠',
                title: tApp('filtersHowItWorksSemanticTitle'),
                body:  tApp('filtersHowItWorksSemanticBody'),
              },
              {
                icon: '⚠️',
                title: tApp('filtersHowItWorksWarnTitle'),
                body:  tApp('filtersHowItWorksWarnBody'),
              },
              {
                icon: '⏱️',
                title: tApp('filtersHowItWorksExpiryTitle'),
                body:  tApp('filtersHowItWorksExpiryBody'),
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
