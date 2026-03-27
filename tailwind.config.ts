import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'ios-bg':              'rgb(var(--color-bg) / <alpha-value>)',
        'ios-bg-secondary':    'rgb(var(--color-bg-secondary) / <alpha-value>)',
        'ios-bg-tertiary':     'rgb(var(--color-bg-tertiary) / <alpha-value>)',
        'ios-label':           'rgb(var(--color-label) / <alpha-value>)',
        'ios-label-secondary': 'rgb(var(--color-label-secondary) / <alpha-value>)',
        'ios-label-tertiary':  'rgb(var(--color-label-tertiary) / <alpha-value>)',
        'ios-fill':            'rgb(var(--color-fill) / <alpha-value>)',
        'ios-blue':            '#007AFF',
        'ios-purple':          '#AF52DE',
        'ios-orange':          '#FF9500',
        'ios-yellow':          '#FFCC00',
        'ios-green':           '#34C759',
        'ios-red':             '#FF3B30',
        'ios-pink':            '#FF2D55',
        'nostr-purple':        '#8B5CF6',
        'zap-orange':          '#F97316',
      },
      fontFamily: {
        system: [
          '-apple-system', 'BlinkMacSystemFont',
          '"SF Pro Display"', '"SF Pro Text"',
          '"Helvetica Neue"', 'sans-serif',
        ],
        mono: ['"SF Mono"', '"Fira Code"', 'monospace'],
      },
      fontSize: {
        'large-title':  ['34px', { lineHeight: '41px', letterSpacing: '0.37px',  fontWeight: '700' }],
        'title-1':      ['28px', { lineHeight: '34px', letterSpacing: '0.36px',  fontWeight: '700' }],
        'title-2':      ['22px', { lineHeight: '28px', letterSpacing: '0.35px',  fontWeight: '700' }],
        'title-3':      ['20px', { lineHeight: '25px', letterSpacing: '0.38px',  fontWeight: '600' }],
        'headline':     ['17px', { lineHeight: '22px', letterSpacing: '-0.41px', fontWeight: '600' }],
        'body':         ['17px', { lineHeight: '22px', letterSpacing: '-0.41px', fontWeight: '400' }],
        'callout':      ['16px', { lineHeight: '21px', letterSpacing: '-0.32px', fontWeight: '400' }],
        'subheadline':  ['15px', { lineHeight: '20px', letterSpacing: '-0.23px', fontWeight: '400' }],
        'footnote':     ['13px', { lineHeight: '18px', letterSpacing: '-0.08px', fontWeight: '400' }],
        'caption-1':    ['12px', { lineHeight: '16px', letterSpacing: '0px',     fontWeight: '400' }],
        'caption-2':    ['11px', { lineHeight: '13px', letterSpacing: '0.07px',  fontWeight: '400' }],
      },
      borderRadius: {
        'ios-sm':  '8px', 'ios-md':  '12px', 'ios-lg':  '16px',
        'ios-xl':  '20px', 'ios-2xl': '28px', 'ios-3xl': '36px',
      },
      backdropBlur: {
        'ios': '40px', 'ios-heavy': '60px',
      },
      spacing: {
        'safe-top':    'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left':   'env(safe-area-inset-left)',
        'safe-right':  'env(safe-area-inset-right)',
      },
      animation: {
        'slide-up':   'slideUp 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-down': 'slideDown 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in':    'fadeIn 0.25s ease-out',
        'spring-in':  'springIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      },
      keyframes: {
        slideUp:   { from: { transform: 'translateY(100%)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { from: { transform: 'translateY(-20px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        springIn:  { from: { transform: 'scale(0.85)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
      },
    },
  },
  darkMode: ['selector', '[data-theme="dark"]'],
}

export default config