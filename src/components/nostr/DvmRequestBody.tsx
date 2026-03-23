import { useState } from 'react'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useApp } from '@/contexts/app-context'
import { useDvmJobActivity } from '@/hooks/useDvmJobActivity'
import {
  canDecryptDvmEvent,
  decryptDvmRequestPrivateTags,
  parseDvmJobRequestEvent,
  type DvmJobInput,
  type DvmJobParam,
} from '@/lib/nostr/dvm'
import type { NostrEvent } from '@/types'

interface DvmRequestBodyProps {
  event: NostrEvent
  className?: string
}

function formatMsats(msats: number): string {
  return `${msats.toLocaleString()} msats`
}

function InputList({
  inputs,
  title,
}: {
  inputs: DvmJobInput[]
  title: string
}) {
  if (inputs.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        {title}
      </p>
      <div className="space-y-2">
        {inputs.map((input, index) => (
          <div
            key={`${input.type}:${input.value}:${index}`}
            className="rounded-[14px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                {input.type}
              </span>
              {input.role && (
                <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2 py-1 text-[11px] text-[rgb(var(--color-label-secondary))]">
                  {input.role}
                </span>
              )}
            </div>

            {input.type === 'url' ? (
              <a
                href={input.value}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-2 block break-all text-[14px] leading-6 text-[#007AFF]"
              >
                {input.value}
              </a>
            ) : (
              <p className="mt-2 break-all font-mono text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                {input.value}
              </p>
            )}

            {input.relayHint && (
              <p className="mt-2 break-all text-[12px] text-[rgb(var(--color-label-tertiary))]">
                Relay {input.relayHint}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ParamList({
  params,
  title,
}: {
  params: DvmJobParam[]
  title: string
}) {
  if (params.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        {title}
      </p>
      <div className="space-y-2">
        {params.map((param, index) => (
          <div
            key={`${param.name}:${param.value}:${index}`}
            className="rounded-[14px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] px-3 py-2"
          >
            <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">
              {param.name}
            </p>
            <p className="mt-1 break-words text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {param.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DvmRequestBody({
  event,
  className = '',
}: DvmRequestBodyProps) {
  const request = parseDvmJobRequestEvent(event)
  const { currentUser } = useApp()
  const { events, loading, error } = useDvmJobActivity(request)
  const [decrypting, setDecrypting] = useState(false)
  const [decryptError, setDecryptError] = useState<string | null>(null)
  const [privatePayload, setPrivatePayload] = useState<Awaited<ReturnType<typeof decryptDvmRequestPrivateTags>> | null>(null)

  if (!request) return null

  const canDecrypt = request.hasEncryptedPayload && canDecryptDvmEvent(event, currentUser?.pubkey)

  const handleDecrypt = async () => {
    if (!canDecrypt || decrypting) return
    setDecrypting(true)
    setDecryptError(null)

    try {
      const payload = await decryptDvmRequestPrivateTags(event, currentUser?.pubkey)
      setPrivatePayload(payload)
    } catch (loadError: unknown) {
      setDecryptError(loadError instanceof Error ? loadError.message : 'Failed to decrypt DVM request payload.')
    } finally {
      setDecrypting(false)
    }
  }

  return (
    <div className={`space-y-4 rounded-[20px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            NIP-90 Job Request
          </p>
          <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
            Kind {request.requestKind}
          </h3>
          <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
            {request.providers.length > 0
              ? `Targeting ${request.providers.length} preferred provider${request.providers.length === 1 ? '' : 's'}.`
              : 'Open to any service provider that supports this request kind.'}
          </p>
        </div>

        {request.isEncrypted && (
          <span className="rounded-full bg-[rgb(var(--color-fill)/0.10)] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            Encrypted
          </span>
        )}
      </div>

      {request.outputs.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            Outputs
          </p>
          <div className="flex flex-wrap gap-2">
            {request.outputs.map((output) => (
              <span
                key={output}
                className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-label-secondary))]"
              >
                {output}
              </span>
            ))}
          </div>
        </div>
      )}

      {request.maxBidMsats !== undefined && (
        <div className="rounded-[14px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] px-3 py-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">
            Max Bid
          </p>
          <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">
            {formatMsats(request.maxBidMsats)}
          </p>
        </div>
      )}

      <InputList inputs={request.inputs} title="Public Inputs" />
      <ParamList params={request.params} title="Public Params" />

      {request.hasEncryptedPayload && (
        <div className="space-y-3 rounded-[16px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] p-3">
          <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
            This request carries encrypted private `i` / `param` tags in the event content.
          </p>

          {canDecrypt && !privatePayload && (
            <button
              type="button"
              onClick={() => void handleDecrypt()}
              disabled={decrypting}
              className="rounded-[14px] bg-[rgb(var(--color-label))] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-45"
            >
              {decrypting ? 'Decrypting…' : 'Decrypt private payload'}
            </button>
          )}

          {!canDecrypt && (
            <p className="text-[13px] leading-6 text-[rgb(var(--color-label-tertiary))]">
              Connect the participating signer with NIP-04 support to decrypt the private payload.
            </p>
          )}

          {decryptError && (
            <p className="text-[13px] text-[rgb(var(--color-system-red))]">
              {decryptError}
            </p>
          )}

          {privatePayload && (
            <div className="space-y-4">
              <InputList inputs={privatePayload.inputs} title="Private Inputs" />
              <ParamList params={privatePayload.params} title="Private Params" />
            </div>
          )}
        </div>
      )}

      {request.providers.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            Preferred Providers
          </p>
          <div className="space-y-2">
            {request.providers.map((provider) => (
              <p
                key={provider}
                className="break-all rounded-[14px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] px-3 py-2 font-mono text-[12px] text-[rgb(var(--color-label-tertiary))]"
              >
                {provider}
              </p>
            ))}
          </div>
        </div>
      )}

      {request.responseRelays.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            Response Relays
          </p>
          <div className="space-y-2">
            {request.responseRelays.map((relay) => (
              <p
                key={relay}
                className="break-all rounded-[14px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label-secondary))]"
              >
                {relay}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          Activity
        </p>

        {events.map((activityEvent) => (
          <EventPreviewCard key={activityEvent.id} event={activityEvent} compact />
        ))}

        {loading && (
          <div className="rounded-[14px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] p-3 text-[14px] text-[rgb(var(--color-label-secondary))]">
            Loading DVM responses…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-[14px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] p-3 text-[14px] text-[rgb(var(--color-system-red))]">
            {error}
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="rounded-[14px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] p-3 text-[14px] text-[rgb(var(--color-label-secondary))]">
            No DVM result or feedback events are cached for this request yet.
          </div>
        )}
      </div>
    </div>
  )
}
