# tonybot

A web-based chat app styled like iMessage, powered by OpenRouter.

## Features
- Responsive chat UI for desktop and mobile
- Typing indicator and multi-bubble responses
- Proactive idle messages for natural conversation flow
- Server-side LLM calls (API key is not exposed to the browser)
- Local conversation logging + CLI log tools

## Tech Stack
- Next.js (App Router)
- React + TypeScript
- OpenRouter (`@openrouter/ai-sdk-provider` + `ai`)

## Requirements
- Node.js 20+
- npm
- OpenRouter API key

## Setup
1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` in the project root:

```env
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6
TONYBOT_MAX_INPUT_CHARS=5000
```

3. Add your persona file in the project root:
- Preferred: `persona_v2.txt`
- Fallback: `persona.txt`

4. Start development server:

```bash
npm run dev
```

5. Open:
- `http://localhost:3000`

## Production
Build and run:

```bash
npm run build
npm run start
```

## Logging Tools
Conversation logs are written to `logs/` in NDJSON format.

- Summary for today:

```bash
npm run logs:today
```

- Summary for a date:

```bash
npm run logs:summary -- --date=YYYY-MM-DD
```

- Live tail:

```bash
npm run logs:live
npm run logs:live -- --ip=YOUR_IP
```

- Export transcript for one IP:

```bash
npm run logs:transcript -- --date=YYYY-MM-DD --ip=YOUR_IP
```

## Security Notes
- Keep `.env.local` private.
- Do not commit local persona files with personal data.
- If exposing publicly, run behind standard network protections (firewall/reverse proxy/rate limits).
