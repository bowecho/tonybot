# tonybot (simple mode)

Minimal web chatbot for short public demos.

- No auth
- No database
- Stateless (messages exist only in-browser for the current page session)
- Uses OpenRouter + Claude Sonnet 4.6
- Server-side key usage only (`OPENROUTER_API_KEY` stays off the client)

## Setup

1. Put your OpenRouter key in `.env.local`:

```env
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6
TONYBOT_MAX_INPUT_CHARS=5000
```

2. Install and run:

```bash
npm install
npm run dev
```

3. Open `http://localhost:3000`.

## Expose publicly from your router

- Forward your chosen external port to this machine on `3000`.
- If using a reverse proxy (recommended), proxy to `http://127.0.0.1:3000`.
- Turn the app off when done.

## Important

- Because this is intentionally simple and public, use it only for short demos.
- Rotate API keys if they were shared in chat.
