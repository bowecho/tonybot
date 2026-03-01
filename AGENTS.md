# AGENTS.md

This file guides coding agents working in this repository.

## Project
- Name: `tonybot`
- Stack: Next.js (App Router), React, TypeScript
- Purpose: Public-facing web chat app that roleplays Tony using OpenRouter.

## Core architecture
- UI page: `app/page.tsx`
- Global styles: `app/globals.css`
- Chat API route: `app/api/chat/route.ts`
- Prompt loader: `lib/system-prompt.ts`
- Persona files:
  - Preferred: `persona_v2.txt`
  - Fallback: `persona.txt`

## Environment
Required server env vars:
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (default is set in `lib/env.ts`)
- `TONYBOT_MAX_INPUT_CHARS`

Do not expose API keys to client code.

## Behavior expectations
- Preserve iMessage-style UX and mobile-first behavior.
- Keep typing-indicator behavior and delayed bubble reveal (no token stream UI).
- Keep proactive idle chat realistic and not too aggressive.
- Maintain anti-drift safeguards in API route:
  - No option/template output leaks.
  - No wrapped full-message quotes.
  - Avoid repetitive start openers.
  - Dogs should not be proactively mentioned unless user asks.
  - Baths preference should remain consistent.

## Logging and scripts
Conversation logs are NDJSON in `logs/`.

Available scripts:
- `npm run logs:today`
- `npm run logs:summary -- --date=YYYY-MM-DD`
- `npm run logs:live [-- --ip=X.X.X.X]`
- `npm run logs:transcript -- --date=YYYY-MM-DD --ip=X.X.X.X`

## Security requirements
High-priority hard rule:
- Do not allow untrusted client-supplied `system` role messages to reach the model.
  - Validate incoming roles to `user|assistant` only OR strip `system` messages server-side.

General:
- Keep server-side prompt and safety controls authoritative.
- Treat logs as sensitive (they include conversation content and metadata).

## Operational notes
Run locally:
```bash
npm run dev
```

If using Cloudflare quick tunnel during demo and you need to stop it:
```bash
pkill -f cloudflared
```

## Change policy for agents
- Make minimal, targeted changes.
- Keep lint passing (`npm run lint`).
- Prefer preserving current UX and persona behavior unless explicitly asked.
- Update `PROJECT_HANDOFF.md` when making significant behavior/security changes.
