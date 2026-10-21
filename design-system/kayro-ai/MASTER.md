# KAYRO AI — Design System

**Status:** Master reference, derived from the installed UI UX Pro Max skill (v2.15.0). The CLI was executed in this repository; the official `design_system.py` generator was run for “AI agent workspace developer dashboard chat integrations Persian RTL”. It recommended an OLED developer workspace, green execution accent, IBM Plex family, keyboard focus, and reduced motion. We adapt its dark-mode foundation with muted evergreen surfaces and a brighter CTA for legibility.

## Product direction

A focused, private AI-agent workspace: calm technical precision, not a marketing landing page. Dashboard → action; chat is the primary workspace; connectivity and model status must never imply unverified success.

## Tokens

- Canvas `#101613`; sidebar `#121915`; surface `#171F1B`; raised surface `#1B2520`.
- Border `#29352E`; text `#E8EEE9`; secondary text `#86948B`.
- Primary/action `#A3EFC0` on `#112319`; success `#62D58B`; info `#91C8ED`; warning `#E4C582`; danger `#ED7B7B`.
- Arabic/Latin UI: IBM Plex Sans Arabic, fallback sans-serif. Code: IBM Plex Mono.
- Spacing uses 4px base; common gaps 8/12/16/24/32px. Radius 6/8/10px. Borders 1px.
- Responsive breakpoints: 480px mobile, 800px tablet, 1050px workspace adjustment.

## Layout & interaction

- RTL is the default; use directional icons intentionally and preserve LTR for code, tokens and numeric identifiers.
- Persistent navigation rail (252px desktop); collapses to drawer on mobile. Chat uses flexible center panel and optional 264px context panel.
- One dominant action per view. Statuses include text and color (never color alone). Errors and incomplete integrations are explicit.
- Buttons have hover/focus/disabled states; keyboard focus uses visible 2px mint outline. Text wraps; long identifiers/code scroll safely.
- Motion 150–200ms, no required motion; respect `prefers-reduced-motion`.
- Body copy at least 11–12px in this dense developer interface; secondary labels are not used for critical instructions.

## Components

- Primary button: mint fill, dark text; secondary: raised surface with border.
- Cards: surface fill + subtle border, 10px radius, 14–16px padding.
- Chat message: role avatar, role/time labels, wrapping content. Composer persists at bottom; send disabled for empty input and while executing.
- Connection state: explicit “آماده / قطع اتصال / در حال بررسی”; green only after a real API response.
- Empty state: icon, clear explanation, one action. Errors: actionable text, no secret values.
- Model selector only displays dynamically verified free models; unknown/paid pricing is excluded.

## Accessibility and QA checklist

- [x] RTL document and Arabic-first font stack.
- [x] Keyboard focus-visible states; semantic buttons and labeled controls.
- [x] Reduced-motion override; responsive 320px+ layout.
- [ ] Verify contrast numerically on every final palette pairing before production release.
- [ ] Screen-reader and browser matrix review required before public launch.
- [ ] Confirm no horizontal overflow at 320/375/768/1024/1440px.
