# Heroes of Misery RPG — Development Rules

## General
- Mobile-first web application.
- Prioritize Android/mobile browser usability.
- Keep client, server, game logic and lore data separated.
- Never hardcode secrets or API keys into frontend code.
- Do not place canonical lore directly inside game-engine logic.
- Prefer simple, maintainable systems over premature complexity.
- New Runs and game actions require a verified NanoGPT connection. Settings and existing saves remain accessible without it; failed AI calls must never advance or overwrite a Run.

## Architecture
- Canon/lore data belongs under `/data/canon`.
- Runtime game state belongs in save data, not canon files.
- Game rules should be deterministic whenever possible.
- AI should interpret narrative meaning, dialogue and dynamic events.
- AI should not be authoritative for money, inventory, time, stats, combat math or save-state truth.
- Client code must never contain private API keys.
- AI requests must go through the local server.

## UI
- Design mobile-first.
- Touch targets must be comfortable on phones.
- Avoid desktop-only layouts.
- Test narrow widths.
- Prefer app-like navigation over long desktop pages.

## Git
- Work primarily on `dev`.
- Before completing a milestone: run tests, lint if configured, verify startup, update README if needed, create a descriptive commit, and push.
- Do not force-push unless explicitly requested.
- Do not commit `.env`, API keys, saves, node_modules or temporary files.

## Scope
- Do not implement the complete HOM lore in the MVP.
- Do not build full combat, full NPC simulation or full AI GM yet.
- Use placeholders/interfaces for future systems.
