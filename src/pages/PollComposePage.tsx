import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
import { getDefaultRelayUrls } from '@/lib/nostr/ndk'
import { publishPoll, type PollType } from '@/lib/nostr/polls'

interface DraftOption {
  id: string
  value: string
}

function parseLineList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export default function PollComposePage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()
  const [question, setQuestion] = useState('')
  const [pollType, setPollType] = useState<PollType>('singlechoice')
  const [endsAtInput, setEndsAtInput] = useState('')
  const [relayUrlsInput, setRelayUrlsInput] = useState(() => getDefaultRelayUrls().join('\n'))
  const [options, setOptions] = useState<DraftOption[]>([
    { id: '1', value: '' },
    { id: '2', value: '' },
  ])
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addOption = () => {
    setOptions((current) => [...current, { id: String(Date.now() + current.length), value: '' }])
  }

  const updateOption = (id: string, value: string) => {
    setOptions((current) => current.map((option) => option.id === id ? { ...option, value } : option))
  }

  const removeOption = (id: string) => {
    setOptions((current) => current.length <= 2 ? current : current.filter((option) => option.id !== id))
  }

  const handlePublish = async () => {
    if (publishing) return
    if (!currentUser) {
      setError('No signer available — install and unlock a NIP-07 extension to publish polls.')
      return
    }

    setPublishing(true)
    setError(null)

    try {
      const published = await publishPoll({
        question,
        options: options.map((option) => option.value),
        relayUrls: parseLineList(relayUrlsInput),
        pollType,
        ...(endsAtInput ? { endsAt: Math.floor(new Date(endsAtInput).getTime() / 1000) } : {}),
      })

      navigate(`/note/${published.id}`, { replace: true })
    } catch (publishError: unknown) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish poll.')
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
            Publish Poll
          </h1>
          <p className="text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
            Publish a NIP-88 kind-1068 poll. Votes are expected to be published to the listed relays as kind-1018 events.
          </p>
        </header>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Question
            </span>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={4}
              placeholder="What should the poll ask?"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="flex items-center justify-between rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3">
            <span className="text-[15px] text-[rgb(var(--color-label))]">Allow multiple choices</span>
            <input
              type="checkbox"
              checked={pollType === 'multiplechoice'}
              onChange={(event) => setPollType(event.target.checked ? 'multiplechoice' : 'singlechoice')}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Ends At
            </span>
            <input
              type="datetime-local"
              value={endsAtInput}
              onChange={(event) => setEndsAtInput(event.target.value)}
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>
        </section>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-semibold text-[rgb(var(--color-label))]">
                Options
              </h2>
              <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                Each option becomes an `option` tag with a generated alphanumeric id.
              </p>
            </div>
            <button
              type="button"
              onClick={addOption}
              className="rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
            >
              Add option
            </button>
          </div>

          <div className="space-y-3">
            {options.map((option, index) => (
              <div key={option.id} className="flex items-center gap-3">
                <span className="w-8 text-center text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                  {index + 1}
                </span>
                <input
                  value={option.value}
                  onChange={(event) => updateOption(option.id, event.target.value)}
                  placeholder={`Option ${index + 1}`}
                  className="flex-1 rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
                />
                <button
                  type="button"
                  onClick={() => removeOption(option.id)}
                  disabled={options.length <= 2}
                  className="rounded-[14px] border border-[rgb(var(--color-system-red)/0.22)] bg-[rgb(var(--color-system-red)/0.08)] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-system-red))] disabled:opacity-35"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Vote Relays
            </span>
            <textarea
              value={relayUrlsInput}
              onChange={(event) => setRelayUrlsInput(event.target.value)}
              rows={5}
              placeholder="One wss:// relay URL per line"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <p className="text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
            These become the poll’s `relay` tags. Respondents are expected to publish kind-1018 votes to this relay set.
          </p>
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
          {publishing ? 'Publishing Poll…' : 'Publish Poll'}
        </button>
      </div>
    </div>
  )
}
