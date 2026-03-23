/**
 * SearchBar
 *
 * Controlled search input with native-style proportions and quiet chrome.
 */

import React, { useRef, useCallback } from 'react'
import { motion } from 'motion/react'

interface SearchBarProps {
  value:        string
  onChange:     (value: string) => void
  onSubmit?:    () => void
  onClear?:     () => void
  placeholder?: string
  autoFocus?:   boolean
  className?:   string
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  onClear,
  placeholder = 'Search notes and people…',
  autoFocus   = false,
  className   = '',
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClear = useCallback(() => {
    onChange('')
    onClear?.()
    inputRef.current?.focus()
  }, [onChange, onClear])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    inputRef.current?.blur()
    onSubmit?.()
  }, [onSubmit])

  return (
    <form onSubmit={handleSubmit} className={`relative flex items-center ${className}`}>
      {/* Search icon */}
      <svg
        width="16" height="16" viewBox="0 0 16 16" fill="none"
        className="absolute left-3.5 text-[rgb(var(--color-label-tertiary))] pointer-events-none"
        aria-hidden
      >
        <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>

      <input
        ref={inputRef}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="
          w-full h-10 pl-10 pr-10
          rounded-[14px]
          border border-[rgb(var(--color-divider)/0.08)]
          bg-[rgb(var(--color-surface-elevated)/0.92)]
          text-[14px] text-[rgb(var(--color-label))]
          placeholder:text-[rgb(var(--color-label-tertiary))]
          outline-none
          shadow-[0_8px_20px_rgba(15,20,30,0.05)]
          transition-[background-color,border-color,box-shadow] duration-150
          focus:border-[rgb(var(--color-accent)/0.28)]
          focus:bg-[rgb(var(--color-surface-elevated))]
          focus:shadow-[0_10px_26px_rgba(15,20,30,0.08)]
        "
        aria-label="Search"
      />

      {/* Clear button — visible only when input has content */}
      {value.length > 0 && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={   { opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.1 }}
          type="button"
          onClick={handleClear}
          className="
            absolute right-2.5
            h-6 w-6 rounded-full
            bg-[rgb(var(--color-fill)/0.22)]
            flex items-center justify-center
            active:opacity-70 transition-opacity
          "
          aria-label="Clear search"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
            <path d="M1 1l6 6M7 1L1 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </motion.button>
      )}
    </form>
  )
}
