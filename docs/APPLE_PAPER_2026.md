# Apple Paper 2026

Design brief for evolving Nostr Paper toward "Facebook Paper redesigned by Apple in 2026."

## Primary references

- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines
- Liquid Glass overview: https://developer.apple.com/documentation/technologyoverviews/liquid-glass
- Safari web app configuration: https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html

## Principles we should follow

- Clarity first. Primary actions, titles, and content types must read instantly.
- Deference. Chrome should support content, not compete with it.
- Depth with restraint. Material and motion should establish hierarchy, not become the personality of every surface.
- Editorial pacing. This app is a reader before it is a dashboard.
- Native-feeling web app behavior. Installed PWA chrome, safe areas, startup states, and top-level navigation should feel intentional on Apple platforms.

## What was wrong in the current UI

- Emoji-based section navigation made the information architecture feel novelty-driven.
- Glass was applied too broadly, flattening hierarchy instead of clarifying it.
- The feed split the hero and list into separate scroll behaviors, which weakened continuity.
- Compose was hidden behind a pull gesture instead of being exposed as a first-class action.
- Search felt like utility chrome instead of a primary destination.
- Global safe-area padding made spacing inconsistent across screens.
- The PWA shell colors did not match the product's visual language.

## Direction for implementation

- Use a warmer paper-like palette in light mode and a deep ink-blue palette in dark mode.
- Reserve material treatments for sticky chrome and transient overlays.
- Favor large titles, concise supporting copy, and clear content labels over decorative affordances.
- Keep motion tied to continuity between feed and detail views.
- Ensure the installed web app launches into the same visual identity as the in-browser app.

## First-pass implementation scope

- Rework global tokens and surface hierarchy.
- Redesign the feed header, search entry, compose action, and section rail.
- Tone down the hero interaction and detail navigation chrome.
- Align the splash screen and PWA theme metadata with the new direction.

## Remaining design debt

- Secondary screens still use hardcoded accent blue in many places.
- Compose flows, settings, filters, and detail pages need the same surface and spacing cleanup.
- Link typography and action styles should be normalized around `--color-accent`.
- A full app-shell pass should evaluate whether a persistent top/bottom navigation model is warranted.
