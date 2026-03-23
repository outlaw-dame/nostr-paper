import { useEffect, useRef, useState } from 'react'
import { Sheet } from 'konsta/react'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useApp } from '@/contexts/app-context'
import { useProfile } from '@/hooks/useProfile'
import {
  buildZapRequest,
  fetchZapInvoice,
  formatZapAmount,
  resolveLnurlPayData,
  type LnurlPayData,
} from '@/lib/nostr/zap'
import { getDefaultRelayUrls } from '@/lib/nostr/ndk'
import type { NostrEvent } from '@/types'

const PRESET_SATS = [21, 100, 500, 1_000, 5_000, 10_000] as const

interface ZapSheetProps {
  open: boolean
  recipientPubkey: string
  targetEvent?: NostrEvent | null
  onClose: () => void
  onZapped?: () => void
}

type ZapStep =
  | { type: 'compose' }
  | { type: 'loading'; message: string }
  | { type: 'invoice'; bolt11: string; amountMsats: number }
  | { type: 'error'; message: string }

export function ZapSheet({
  open,
  recipientPubkey,
  targetEvent = null,
  onClose,
  onZapped,
}: ZapSheetProps) {
  const { currentUser } = useApp()
  const { profile } = useProfile(recipientPubkey)

  const [amountSats, setAmountSats] = useState<number>(21)
  const [customSats, setCustomSats] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [comment, setComment] = useState('')
  const [step, setStep] = useState<ZapStep>({ type: 'compose' })
  const [copied, setCopied] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  // Reset state when sheet opens/closes
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      abortRef.current = null
      return
    }
    setAmountSats(21)
    setCustomSats('')
    setUseCustom(false)
    setComment('')
    setStep({ type: 'compose' })
    setCopied(false)
  }, [open])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const effectiveAmountSats = useCustom
    ? Math.max(1, Math.min(10_000_000, parseInt(customSats, 10) || 1))
    : amountSats

  const lnAddress = profile?.lud16 ?? profile?.lud06 ?? null

  const closeSheet = () => {
    if (step.type === 'loading') return
    onClose()
  }

  const handleGetInvoice = async () => {
    if (!currentUser) return
    if (!lnAddress) {
      setStep({ type: 'error', message: 'This profile has no lightning address configured.' })
      return
    }

    const controller = new AbortController()
    abortRef.current = controller

    setStep({ type: 'loading', message: 'Fetching lightning address…' })

    try {
      let payData: LnurlPayData
      try {
        payData = await resolveLnurlPayData(lnAddress)
      } catch (err) {
        throw new Error(`Could not reach lightning address: ${err instanceof Error ? err.message : String(err)}`)
      }

      if (!payData.allowsNostr) {
        throw new Error("This lightning address doesn't support Nostr zaps.")
      }

      const amountMsats = effectiveAmountSats * 1000

      if (amountMsats < payData.minSendable) {
        throw new Error(`Minimum zap is ${formatZapAmount(payData.minSendable)} sats.`)
      }
      if (amountMsats > payData.maxSendable) {
        throw new Error(`Maximum zap is ${formatZapAmount(payData.maxSendable)} sats.`)
      }

      if (controller.signal.aborted) return
      setStep({ type: 'loading', message: 'Signing zap request…' })

      // Determine the lnurl to embed in the zap request (for wallet interop)
      const lnurlForTag = lnAddress.startsWith('lnurl') ? lnAddress : undefined

      const zapRequestOptions = {
        recipientPubkey,
        amountMsats,
        targetEvent,
        relays: getDefaultRelayUrls(),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(lnurlForTag ? { lnurl: lnurlForTag } : {}),
      }

      const zapRequest = await buildZapRequest(
        zapRequestOptions,
        controller.signal,
      )

      if (controller.signal.aborted) return
      setStep({ type: 'loading', message: 'Requesting invoice…' })

      const bolt11 = await fetchZapInvoice(payData, zapRequest, amountMsats)

      if (controller.signal.aborted) return
      setStep({ type: 'invoice', bolt11, amountMsats })
      onZapped?.()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setStep({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to create zap invoice.',
      })
    } finally {
      abortRef.current = null
    }
  }

  const handleOpenWallet = (bolt11: string) => {
    window.open(`lightning:${bolt11}`, '_self')
  }

  const handleCopy = async (bolt11: string) => {
    try {
      await navigator.clipboard.writeText(bolt11)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard not available
    }
  }

  const handleTryAgain = () => {
    setStep({ type: 'compose' })
    setCopied(false)
  }

  const canZap = !!currentUser && !!lnAddress && step.type === 'compose'

  return (
    <Sheet
      opened={open}
      onBackdropClick={closeSheet}
      className="rounded-t-[28px]"
    >
      <div className="pb-safe min-h-[55vh] flex flex-col">
        {/* Drag handle */}
        <div className="flex justify-center pb-2 pt-3">
          <div className="h-1 w-10 rounded-full bg-[rgb(var(--color-fill)/0.3)]" />
        </div>

        <div className="flex flex-1 flex-col gap-4 px-5 py-2 pb-6">
          {/* Header */}
          <div>
            <h2 className="text-headline text-[rgb(var(--color-label))]">
              ⚡ Zap
            </h2>
            <p className="mt-0.5 text-[13px] text-[rgb(var(--color-label-secondary))]">
              Send a lightning payment via Nostr
            </p>
          </div>

          {/* Recipient */}
          <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
            <AuthorRow pubkey={recipientPubkey} profile={profile} />
            {lnAddress && (
              <p className="mt-1.5 truncate pl-1 font-mono text-[11px] text-[rgb(var(--color-label-tertiary))]">
                {lnAddress}
              </p>
            )}
            {!lnAddress && (
              <p className="mt-1.5 text-[12px] text-[rgb(var(--color-system-red))]">
                No lightning address found on this profile.
              </p>
            )}
          </div>

          {/* Compose step */}
          {(step.type === 'compose' || step.type === 'error') && (
            <>
              {/* Amount presets */}
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                  Amount (sats)
                </p>
                <div className="flex flex-wrap gap-2">
                  {PRESET_SATS.map((sats) => (
                    <button
                      key={sats}
                      type="button"
                      onClick={() => { setUseCustom(false); setAmountSats(sats) }}
                      className={`
                        rounded-full border px-3.5 py-1.5 text-[13px] font-medium
                        transition-colors active:opacity-80
                        ${!useCustom && amountSats === sats
                          ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                          : 'border-[rgb(var(--color-fill)/0.16)] text-[rgb(var(--color-label-secondary))]'
                        }
                      `}
                    >
                      {sats >= 1000 ? `${sats / 1000}k` : sats}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setUseCustom(true)}
                    className={`
                      rounded-full border px-3.5 py-1.5 text-[13px] font-medium
                      transition-colors active:opacity-80
                      ${useCustom
                        ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                        : 'border-[rgb(var(--color-fill)/0.16)] text-[rgb(var(--color-label-secondary))]'
                      }
                    `}
                  >
                    Custom
                  </button>
                </div>

                {useCustom && (
                  <input
                    type="number"
                    value={customSats}
                    onChange={(e) => setCustomSats(e.target.value)}
                    placeholder="Amount in sats"
                    min={1}
                    inputMode="numeric"
                    autoFocus
                    className="
                      mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                      bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5
                      text-[15px] text-[rgb(var(--color-label))]
                      placeholder:text-[rgb(var(--color-label-tertiary))]
                      outline-none
                    "
                  />
                )}
              </div>

              {/* Comment */}
              <label className="block">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                  Message (optional)
                </span>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a message to your zap…"
                  maxLength={280}
                  rows={2}
                  className="
                    mt-2 w-full resize-none rounded-[18px] border border-[rgb(var(--color-fill)/0.18)]
                    bg-[rgb(var(--color-bg-secondary))] px-4 py-3
                    text-[15px] leading-6 text-[rgb(var(--color-label))]
                    outline-none
                    placeholder:text-[rgb(var(--color-label-tertiary))]
                  "
                />
              </label>

              {step.type === 'error' && (
                <p className="rounded-[14px] bg-[rgb(var(--color-system-red)/0.08)] px-4 py-3 text-[13px] text-[rgb(var(--color-system-red))]">
                  {step.message}
                </p>
              )}

              {!currentUser && (
                <p className="text-[13px] text-[rgb(var(--color-system-red))]">
                  Install a NIP-07 signer extension to send zaps.
                </p>
              )}
            </>
          )}

          {/* Loading step */}
          {step.type === 'loading' && (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                {step.message}
              </p>
            </div>
          )}

          {/* Invoice step */}
          {step.type === 'invoice' && (
            <div className="space-y-3">
              <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-4 text-center">
                <p className="text-[32px] font-bold leading-tight text-[rgb(var(--color-label))]">
                  ⚡ {formatZapAmount(step.amountMsats)}
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  sats
                </p>
              </div>

              <p className="text-center text-[13px] text-[rgb(var(--color-label-secondary))]">
                Open in your wallet or copy the invoice to pay.
              </p>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => handleOpenWallet(step.bolt11)}
                  className="
                    w-full rounded-[14px] bg-[#F7931A]
                    px-4 py-3 text-[15px] font-semibold text-white
                    transition-opacity active:opacity-80
                  "
                >
                  Open in Wallet
                </button>

                <button
                  type="button"
                  onClick={() => void handleCopy(step.bolt11)}
                  className="
                    w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                    bg-[rgb(var(--color-bg-secondary))] px-4 py-3
                    text-[15px] font-medium text-[rgb(var(--color-label))]
                    transition-opacity active:opacity-80
                  "
                >
                  {copied ? 'Copied!' : 'Copy Invoice'}
                </button>
              </div>

              <div className="overflow-hidden rounded-[12px] bg-[rgb(var(--color-fill)/0.05)] px-3 py-2">
                <p className="break-all font-mono text-[10px] leading-5 text-[rgb(var(--color-label-tertiary))] line-clamp-3">
                  {step.bolt11}
                </p>
              </div>
            </div>
          )}

          {/* Footer buttons */}
          <div className="mt-auto flex gap-2">
            {(step.type === 'compose' || step.type === 'error') && (
              <>
                <button
                  type="button"
                  onClick={closeSheet}
                  className="
                    flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                    bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
                    text-[14px] font-medium text-[rgb(var(--color-label))]
                    transition-opacity active:opacity-75
                  "
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() => void handleGetInvoice()}
                  disabled={!canZap}
                  className="
                    flex-1 rounded-[14px] bg-[#F7931A]
                    px-4 py-2.5 text-[14px] font-semibold text-white
                    transition-opacity active:opacity-80 disabled:opacity-40
                  "
                >
                  Get Invoice
                </button>
              </>
            )}

            {step.type === 'loading' && (
              <button
                type="button"
                onClick={() => { abortRef.current?.abort(); setStep({ type: 'compose' }) }}
                className="
                  flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                  bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
                  text-[14px] font-medium text-[rgb(var(--color-label))]
                  transition-opacity active:opacity-75
                "
              >
                Cancel
              </button>
            )}

            {step.type === 'invoice' && (
              <>
                <button
                  type="button"
                  onClick={handleTryAgain}
                  className="
                    flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                    bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
                    text-[14px] font-medium text-[rgb(var(--color-label))]
                    transition-opacity active:opacity-75
                  "
                >
                  New Zap
                </button>

                <button
                  type="button"
                  onClick={closeSheet}
                  className="
                    flex-1 rounded-[14px] bg-[rgb(var(--color-label))]
                    px-4 py-2.5 text-[14px] font-semibold text-white
                    transition-opacity active:opacity-80
                  "
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  )
}
