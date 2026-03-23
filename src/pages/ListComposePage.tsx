import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
import {
  getNip51ListDefinition,
  getNip51ListDefinitions,
  parseNip51ListEvent,
  publishNip51List,
} from '@/lib/nostr/lists'
import { Kind } from '@/types'

interface DraftListItem {
  id: string
  tagName: string
  values: string[]
  isPrivate: boolean
}

function createDraftId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createDraftItem(defaultTagName: string): DraftListItem {
  return {
    id: createDraftId('list-item'),
    tagName: defaultTagName,
    values: ['', '', '', ''],
    isPrivate: false,
  }
}

function getValuePlaceholders(tagName: string): string[] {
  switch (tagName.trim()) {
    case 'p':
      return ['pubkey', 'relay hint', 'petname', '']
    case 'e':
      return ['event id', 'relay hint', 'marker', '']
    case 'a':
      return ['kind:pubkey:identifier', '', '', '']
    case 't':
      return ['hashtag', '', '', '']
    case 'word':
      return ['lowercase word', '', '', '']
    case 'group':
      return ['group id', 'relay URL', 'group name', '']
    case 'emoji':
      return ['shortcode', 'image URL', '', '']
    case 'relay':
    case 'r':
      return ['relay URL', 'marker', '', '']
    default:
      return ['value 1', 'value 2', 'value 3', 'value 4']
  }
}

export default function ListComposePage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()
  const definitions = useMemo(() => getNip51ListDefinitions(), [])
  const [kindInput, setKindInput] = useState(String(Kind.Bookmarks))
  const definition = useMemo(() => getNip51ListDefinition(Number(kindInput)), [kindInput])
  const [identifier, setIdentifier] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [items, setItems] = useState<DraftListItem[]>([
    createDraftItem(getNip51ListDefinition(Kind.Bookmarks)?.expectedTagNames[0] ?? 'e'),
  ])
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addItem = () => {
    setItems((current) => [
      ...current,
      createDraftItem(definition?.expectedTagNames[0] ?? 'p'),
    ])
  }

  const updateItem = (id: string, patch: Partial<DraftListItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const updateItemValue = (id: string, index: number, value: string) => {
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item
      const values = [...item.values]
      values[index] = value
      return { ...item, values }
    }))
  }

  const removeItem = (id: string) => {
    setItems((current) => current.length <= 1 ? current : current.filter((item) => item.id !== id))
  }

  const handlePublish = async () => {
    if (publishing) return
    if (!currentUser) {
      setError('No signer available — install and unlock a NIP-07 extension to publish NIP-51 lists.')
      return
    }
    if (!definition) {
      setError('Choose a supported NIP-51 list kind.')
      return
    }

    setPublishing(true)
    setError(null)

    try {
      const publicItems = items
        .filter((item) => !item.isPrivate)
        .map((item) => ({
          tagName: item.tagName,
          values: item.values.filter((value) => value.trim().length > 0),
        }))
      const privateItems = items
        .filter((item) => item.isPrivate)
        .map((item) => ({
          tagName: item.tagName,
          values: item.values.filter((value) => value.trim().length > 0),
        }))

      const published = await publishNip51List({
        kind: definition.kind,
        ...(definition.addressable ? { identifier, title, description, image } : {}),
        publicItems,
        privateItems,
      })

      const parsed = parseNip51ListEvent(published)
      navigate(parsed?.route ?? `/note/${published.id}`, { replace: true })
    } catch (publishError: unknown) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish the NIP-51 list.')
      setPublishing(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pt-safe pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-4 py-2 text-[15px] text-[rgb(var(--color-label))]"
        >
          Back
        </button>
      </div>

      <div className="space-y-6 pb-10 pt-4">
        <header className="space-y-2">
          <h1 className="text-[34px] leading-[1.05] tracking-[-0.04em] font-semibold text-[rgb(var(--color-label))]">
            Publish NIP-51 List
          </h1>
          <p className="text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
            Publish a standard NIP-51 list or addressable set. Public items go in event tags. Private items are encrypted into `.content` with NIP-44, while older NIP-04 lists remain readable.
          </p>
        </header>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              List Kind
            </span>
            <select
              value={kindInput}
              onChange={(event) => setKindInput(event.target.value)}
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            >
              {definitions.map((item) => (
                <option key={item.kind} value={item.kind}>
                  {item.kind} — {item.name}
                </option>
              ))}
            </select>
          </label>

          {definition && (
            <>
              <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                {definition.description}
              </p>
              <p className="text-[13px] leading-6 text-[rgb(var(--color-label-tertiary))]">
                Expected tag names: {definition.expectedTagNames.join(', ')}.
              </p>
            </>
          )}
        </section>

        {definition?.addressable && (
          <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
            <label className="block space-y-2">
              <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Identifier (`d`)
              </span>
              <input
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder={definition.identifierRule === 'kind-string' ? '1' : 'favorites'}
                className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Title
              </span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Optional title"
                className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Description
              </span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                placeholder="Optional description"
                className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Image
              </span>
              <input
                type="url"
                value={image}
                onChange={(event) => setImage(event.target.value)}
                placeholder="https://example.com/image.jpg"
                className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
              />
            </label>

            {definition.identifierRule === 'kind-string' && (
              <p className="text-[13px] leading-6 text-[rgb(var(--color-label-tertiary))]">
                This set’s `d` tag must be the muted event kind as a decimal string, for example `1` for kind-1 notes.
              </p>
            )}
          </section>
        )}

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-semibold text-[rgb(var(--color-label))]">
                Items
              </h2>
              <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                Add public tag items or mark rows private to encrypt them into event content.
              </p>
            </div>

            <button
              type="button"
              onClick={addItem}
              className="rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
            >
              Add item
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item, index) => {
              const placeholders = getValuePlaceholders(item.tagName)

              return (
                <div key={item.id} className="space-y-3 rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                      Item {index + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      disabled={items.length <= 1}
                      className="rounded-[12px] border border-[rgb(var(--color-system-red)/0.22)] bg-[rgb(var(--color-system-red)/0.08)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--color-system-red))] disabled:opacity-35"
                    >
                      Remove
                    </button>
                  </div>

                  <label className="block space-y-2">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                      Tag name
                    </span>
                    <input
                      type="text"
                      value={item.tagName}
                      onChange={(event) => updateItem(item.id, { tagName: event.target.value })}
                      placeholder={definition?.expectedTagNames[0] ?? 'p'}
                      className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {item.values.map((value, valueIndex) => (
                      <input
                        key={`${item.id}:${valueIndex}`}
                        type="text"
                        value={value}
                        onChange={(event) => updateItemValue(item.id, valueIndex, event.target.value)}
                        placeholder={placeholders[valueIndex] || `value ${valueIndex + 1}`}
                        className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
                      />
                    ))}
                  </div>

                  <label className="flex items-center justify-between rounded-[14px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] px-3 py-3">
                    <span className="text-[14px] text-[rgb(var(--color-label))]">
                      Encrypt this item into `.content`
                    </span>
                    <input
                      type="checkbox"
                      checked={item.isPrivate}
                      onChange={(event) => updateItem(item.id, { isPrivate: event.target.checked })}
                    />
                  </label>
                </div>
              )
            })}
          </div>
        </section>

        {error && (
          <p className="text-[14px] text-[rgb(var(--color-system-red))]">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void handlePublish()}
          disabled={publishing}
          className="w-full rounded-[18px] bg-[rgb(var(--color-label))] px-5 py-4 text-[15px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
        >
          {publishing ? 'Publishing List…' : 'Publish NIP-51 List'}
        </button>
      </div>
    </div>
  )
}
