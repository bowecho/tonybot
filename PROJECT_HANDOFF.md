# Tonybot Project Handoff

Last updated: 2026-03-01

## 1. What this app is
- Public-facing web chat app named **tonybot**.
- Frontend: Next.js app with iMessage-style UI.
- Backend: `app/api/chat/route.ts` calling OpenRouter with Anthropic Claude Sonnet 4.6 (`OPENROUTER_MODEL`).
- Persona source is loaded from text files:
  - Primary: `persona_v2.txt`
  - Fallback: `persona.txt`

## 2. Major work completed

### Core chat functionality
- Built web chat UI and `/api/chat` endpoint.
- Uses server-side OpenRouter API key (not exposed to browser code).
- Sends/receives message history and returns assistant bubbles.

### Persona + behavior
- Added/maintained runtime guardrails in API layer for style consistency.
- Added support for `persona_v2.txt` as preferred prompt source in `lib/system-prompt.ts`.
- Copied key improvements into `persona_v2.txt`:
  - Bath preference (prefers baths, not showers).
  - Do not proactively mention dogs unless user asks.

### Natural texting behavior
- Typing indicator + delayed message reveal to simulate real texting.
- Multi-bubble output support (1-4 bubbles) with pauses between bubbles.
- No token streaming UI; full-bubble display after typing delay.
- Proactive/idle messages when user is inactive.
- Proactive timing was tuned to be less aggressive with cooldown/backoff.

### Anti-drift/quality guards
- Strips wrapping quotes around full bubbles.
- Blocks option/template-style assistant outputs (e.g., "Option A/B/C", "Here are a few options") and regenerates.
- Added start-mode anti-template protections to reduce repetitive openers (e.g., repeated "Man, did you see...").

### Logging + observability
- Added NDJSON conversation logging under `logs/`.
- Added summary script: `scripts/log-summary.mjs`.
- Added per-IP transcript export: `scripts/log-transcript.mjs`.
- Added live log watcher: `scripts/log-live.mjs`.
- Added error details into logs (`errorMessage`, `errorClass`).
- Added response IP/userAgent logging on successful responses too.

### Reliability improvements
- Moved to single text-generation path in API route.
- Added server-side retry for transient model failures (`provider`, `network`, `timeout`) with short jitter.

### UI/UX + mobile fixes
- Styled toward iMessage session feel.
- Removed branding/model disclosure in UI (shows Tony persona only).
- Enter-to-send support added.
- Wallpaper background integrated.
- Hid Next dev "N" devtools floating button.
- Multiple iPhone/Safari fixes for composer overlap and viewport behavior:
  - Safe-area handling.
  - Sticky composer.
  - `visualViewport`-driven app height (`--app-height`) for dynamic Safari chrome.

### Tunnel/ops
- Cloudflare quick tunnel was used during testing and then shut down.

## 3. Files changed (high-impact)
- `app/api/chat/route.ts`
- `app/page.tsx`
- `app/globals.css`
- `lib/system-prompt.ts`
- `persona_v2.txt`
- `scripts/log-summary.mjs`
- `scripts/log-transcript.mjs`
- `scripts/log-live.mjs`
- `package.json` (log scripts)

## 4. Useful commands

### Run app
```bash
cd /home/tonyc/source/tonybot
npm run dev
```

### Log monitoring
```bash
npm run logs:today
npm run logs:summary -- --date=$(date +%F)
npm run logs:live
npm run logs:live -- --ip=YOUR_IP
npm run logs:transcript -- --date=$(date +%F) --ip=YOUR_IP
```

### Stop tunnel
```bash
pkill -f cloudflared
```

## 5. Current known issue(s) / outstanding work

### Security review item still open (important)
A review flagged this and it still needs patching:
- **Reject/strip client-supplied `system` role messages** in `app/api/chat/route.ts`.
- Why: API is public and unauthenticated; allowing client `system` role enables prompt injection against server persona/rules.
- Fix options:
  1. Validate request roles to only `user` and `assistant`.
  2. Or strip `system` messages server-side before forwarding.

## 6. Deployment/security notes
- Keep OpenRouter key server-only in `.env.local` (never expose in client bundle).
- For public internet testing without auth, expect misuse/spam risk.
- Logs currently store conversation text and IP metadata; treat as sensitive.

## 7. Resume checklist (next session)
1. Patch `system` role injection issue in `app/api/chat/route.ts`.
2. Run quick log validation after patch (`npm run logs:live`).
3. Regression test from mobile Safari and desktop.
4. Optional: tune proactive opener variety further if needed.

## 8. Project state snapshot
- App is running locally via Next.js dev server when started with `npm run dev`.
- Cloudflare tunnel is currently off.
- Persona loading preference is now `persona_v2.txt` first.
