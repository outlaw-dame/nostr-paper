# UI component conventions

This folder hosts lightweight UI primitives and shared widgets.

## Safe area classes
- `top-safe` keeps status banners visible below device status bar iOS/Android.
- `rounded-ios-lg`, `rounded-ios-2xl` are rounded corners suggested for mobile dialogs.

## Utility components
- `ActionButton` is a thin wrapper with default `type="button"` to prevent accidental form submission in nested buttons.
- `ErrorScreen` is a full-page fallback state with a reload action.
- `UpdateBanner` and `OfflineBanner` are app-level status bars in fixed overlay.

## Motion behavior
- These components use `motion/react` from framer-motion for enter/exit transitions.
- In SSR situations, motion components can emit `useLayoutEffect` warnings; render them only where DOM is available (client).