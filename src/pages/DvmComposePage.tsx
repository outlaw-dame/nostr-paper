import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
import { publishDvmJobRequest, type DvmInputType } from '@/lib/nostr/dvm'
import { getDefaultRelayUrls } from '@/lib/nostr/ndk'

interface DraftInput {
  id: string
  type: DvmInputType
  value: string
  relayHint: string
  role: string
}

interface DraftParam {
  id: string
  name: string
  value: string
}

function createDraftId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseLineList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export default function DvmComposePage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()
  const [requestKindInput, setRequestKindInput] = useState('5000')
  const [encryptPrivateInputs, setEncryptPrivateInputs] = useState(false)
  const [outputsInput, setOutputsInput] = useState('text/plain')
  const [relayUrlsInput, setRelayUrlsInput] = useState(() => getDefaultRelayUrls().join('\n'))
  const [providerPubkeysInput, setProviderPubkeysInput] = useState('')
  const [maxBidInput, setMaxBidInput] = useState('')
  const [inputs, setInputs] = useState<DraftInput[]>([
    {
      id: createDraftId('input'),
      type: 'text',
      value: '',
      relayHint: '',
      role: '',
    },
  ])
  const [params, setParams] = useState<DraftParam[]>([
    {
      id: createDraftId('param'),
      name: '',
      value: '',
    },
  ])
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addInput = () => {
    setInputs((current) => [
      ...current,
      {
        id: createDraftId('input'),
        type: 'text',
        value: '',
        relayHint: '',
        role: '',
      },
    ])
  }

  const updateInput = (id: string, patch: Partial<DraftInput>) => {
    setInputs((current) => current.map((input) => input.id === id ? { ...input, ...patch } : input))
  }

  const removeInput = (id: string) => {
    setInputs((current) => current.length <= 1 ? current : current.filter((input) => input.id !== id))
  }

  const addParam = () => {
    setParams((current) => [
      ...current,
      {
        id: createDraftId('param'),
        name: '',
        value: '',
      },
    ])
  }

  const updateParam = (id: string, patch: Partial<DraftParam>) => {
    setParams((current) => current.map((param) => param.id === id ? { ...param, ...patch } : param))
  }

  const removeParam = (id: string) => {
    setParams((current) => current.length <= 1 ? current : current.filter((param) => param.id !== id))
  }

  const handlePublish = async () => {
    if (publishing) return
    if (!currentUser) {
      setError('No signer available — install and unlock a NIP-07 extension to publish DVM requests.')
      return
    }

    const requestKind = Number(requestKindInput)
    if (!Number.isSafeInteger(requestKind)) {
      setError('Request kind must be an integer in the 5000-5999 range.')
      return
    }

    const maxBidMsats = maxBidInput.trim().length > 0 ? Number(maxBidInput) : undefined
    if (maxBidInput.trim().length > 0 && !Number.isSafeInteger(maxBidMsats)) {
      setError('Max bid must be a whole number of millisats.')
      return
    }

    setPublishing(true)
    setError(null)

    try {
      const published = await publishDvmJobRequest({
        requestKind,
        inputs: inputs.map((input) => ({
          type: input.type,
          value: input.value,
          ...(input.relayHint.trim() ? { relayHint: input.relayHint.trim() } : {}),
          ...(input.role.trim() ? { role: input.role.trim() } : {}),
        })),
        outputs: parseLineList(outputsInput),
        params: params.map((param) => ({
          name: param.name,
          value: param.value,
        })),
        responseRelays: parseLineList(relayUrlsInput),
        providerPubkeys: parseLineList(providerPubkeysInput),
        ...(maxBidMsats !== undefined ? { maxBidMsats } : {}),
        encryptPrivateInputs,
      })

      navigate(`/note/${published.id}`, { replace: true })
    } catch (publishError: unknown) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish DVM request.')
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
            Publish DVM Job Request
          </h1>
          <p className="text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
            Publish a generic NIP-90 request in the `5000-5999` range. This client acts as a DVM customer, not a service provider.
          </p>
        </header>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Request Kind
            </span>
            <input
              type="number"
              min={5000}
              max={5999}
              step={1}
              value={requestKindInput}
              onChange={(event) => setRequestKindInput(event.target.value)}
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Output Formats
            </span>
            <textarea
              value={outputsInput}
              onChange={(event) => setOutputsInput(event.target.value)}
              rows={3}
              placeholder="One output format per line, for example text/plain"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Max Bid (msats)
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={maxBidInput}
              onChange={(event) => setMaxBidInput(event.target.value)}
              placeholder="Optional"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="flex items-center justify-between rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3">
            <span className="max-w-[70%] text-[15px] leading-6 text-[rgb(var(--color-label))]">
              Encrypt `i` and `param` tags into event content with NIP-04
            </span>
            <input
              type="checkbox"
              checked={encryptPrivateInputs}
              onChange={(event) => setEncryptPrivateInputs(event.target.checked)}
            />
          </label>
        </section>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-semibold text-[rgb(var(--color-label))]">
                Inputs
              </h2>
              <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                Each row becomes an `i` tag. Event/job inputs can include a relay hint and any input can include a role.
              </p>
            </div>
            <button
              type="button"
              onClick={addInput}
              className="rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
            >
              Add input
            </button>
          </div>

          <div className="space-y-3">
            {inputs.map((input, index) => (
              <div key={input.id} className="space-y-3 rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                    Input {index + 1}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeInput(input.id)}
                    disabled={inputs.length <= 1}
                    className="rounded-[12px] border border-[rgb(var(--color-system-red)/0.22)] bg-[rgb(var(--color-system-red)/0.08)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--color-system-red))] disabled:opacity-35"
                  >
                    Remove
                  </button>
                </div>

                <select
                  value={input.type}
                  onChange={(event) => updateInput(input.id, { type: event.target.value as DvmInputType })}
                  className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none"
                >
                  <option value="text">text</option>
                  <option value="url">url</option>
                  <option value="event">event</option>
                  <option value="job">job</option>
                </select>

                <input
                  value={input.value}
                  onChange={(event) => updateInput(input.id, { value: event.target.value })}
                  placeholder={input.type === 'text'
                    ? 'Input text'
                    : input.type === 'url'
                      ? 'https://example.com/input'
                      : '32-byte lowercase hex event id'}
                  className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none"
                />

                {(input.type === 'event' || input.type === 'job') && (
                  <input
                    value={input.relayHint}
                    onChange={(event) => updateInput(input.id, { relayHint: event.target.value })}
                    placeholder="wss://relay.example.com"
                    className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none"
                  />
                )}

                <input
                  value={input.role}
                  onChange={(event) => updateInput(input.id, { role: event.target.value })}
                  placeholder="Optional role, for example source or context"
                  className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none"
                />
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-semibold text-[rgb(var(--color-label))]">
                Params
              </h2>
              <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                Each row becomes a `param` tag with a key and value.
              </p>
            </div>
            <button
              type="button"
              onClick={addParam}
              className="rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
            >
              Add param
            </button>
          </div>

          <div className="space-y-3">
            {params.map((param, index) => (
              <div key={param.id} className="space-y-3 rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                    Param {index + 1}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeParam(param.id)}
                    disabled={params.length <= 1}
                    className="rounded-[12px] border border-[rgb(var(--color-system-red)/0.22)] bg-[rgb(var(--color-system-red)/0.08)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--color-system-red))] disabled:opacity-35"
                  >
                    Remove
                  </button>
                </div>

                <input
                  value={param.name}
                  onChange={(event) => updateParam(param.id, { name: event.target.value })}
                  placeholder="model"
                  className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none"
                />

                <input
                  value={param.value}
                  onChange={(event) => updateParam(param.id, { value: event.target.value })}
                  placeholder="llama-3"
                  className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none"
                />
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Response Relays
            </span>
            <textarea
              value={relayUrlsInput}
              onChange={(event) => setRelayUrlsInput(event.target.value)}
              rows={5}
              placeholder="One relay URL per line"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Preferred Provider Pubkeys
            </span>
            <textarea
              value={providerPubkeysInput}
              onChange={(event) => setProviderPubkeysInput(event.target.value)}
              rows={4}
              placeholder="One lowercase hex pubkey per line"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <p className="text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
            Encrypted requests require exactly one provider pubkey because NIP-90 private payloads use NIP-04 with a single counterparty.
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
          {publishing ? 'Publishing DVM Request…' : 'Publish DVM Request'}
        </button>
      </div>
    </div>
  )
}
