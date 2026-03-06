import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getEnv } from '@/lib/env';
import { loadSystemPrompt } from '@/lib/system-prompt';

const chatModeSchema = z.enum(['normal', 'start', 'idle']);

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(12000),
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).max(80),
  mode: chatModeSchema.default('normal'),
});

function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getClientIp(request: Request) {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp;
  }

  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    return xff.split(',')[0]?.trim() ?? 'unknown';
  }

  return 'unknown';
}

async function appendConversationLog(event: Record<string, unknown>) {
  if (!logsDirReady) {
    const logsDir = path.join(process.cwd(), 'logs');
    logsDirReady = fs.mkdir(logsDir, { recursive: true });
  }

  try {
    await logsDirReady;

    const logsDir = path.join(process.cwd(), 'logs');
    const dateKey = new Date().toISOString().slice(0, 10);
    const logPath = path.join(logsDir, `conversations-${dateKey}.ndjson`);
    await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Never block chat flow if logging fails.
  }
}
let logsDirReady: Promise<void> | null = null;

function toModelMessages(messages: Array<z.infer<typeof chatMessageSchema>>) {
  return messages.map((message) => ({
    role: message.role,
    content: message.text,
  }));
}

function buildModeInstruction(mode: z.infer<typeof chatModeSchema>) {
  if (mode === 'start') {
    return `Send the first text naturally, like you are casually starting a conversation with a friend.
Avoid formulaic opener templates. Do not start with phrases like:
- "Man, did you see..."
- "Hey so I just..."
- "Anybody alive in here"
- "You still alive over there"
Vary sentence structure and tone across conversation starts.`;
  }

  if (mode === 'idle') {
    return 'The other person has been quiet for a bit. Send a short, casual follow-up to re-engage naturally.';
  }

  return null;
}

function recentAssistantMessages(messages: Array<z.infer<typeof chatMessageSchema>>, limit = 8) {
  return messages
    .filter((message) => message.role === 'assistant')
    .slice(-limit)
    .map((message) => message.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((message) => message.slice(0, 180));
}

function normalizeBubbles(values: string[]) {
  const stripWrappingQuotes = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) return trimmed;

    const pairs: Array<[string, string]> = [
      ['"', '"'],
      ["'", "'"],
      ['“', '”'],
      ['‘', '’'],
    ];

    for (const [start, end] of pairs) {
      if (trimmed.startsWith(start) && trimmed.endsWith(end)) {
        return trimmed.slice(start.length, trimmed.length - end.length).trim();
      }
    }

    return trimmed;
  };

  return values
    .map((value) =>
      stripWrappingQuotes(
        value
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim(),
      ),
    )
    .filter(Boolean)
    .slice(0, 4);
}

function extractBubblesFromFallback(text: string) {
  const cleaned = text.trim();

  const parseJsonObject = (candidate: string) => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'bubbles' in parsed &&
        Array.isArray((parsed as { bubbles: unknown }).bubbles)
      ) {
        return normalizeBubbles((parsed as { bubbles: string[] }).bubbles);
      }
    } catch {
      return null;
    }

    return null;
  };

  const fencedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    const fromFence = parseJsonObject(fencedMatch[1].trim());
    if (fromFence && fromFence.length > 0) {
      return fromFence;
    }
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const fromBraces = parseJsonObject(cleaned.slice(firstBrace, lastBrace + 1).trim());
    if (fromBraces && fromBraces.length > 0) {
      return fromBraces;
    }
  }

  return normalizeBubbles([
    cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^here'?s the json response:\s*/i, '')
      .trim(),
  ]);
}

function isMetaOptionsStyleReply(text: string) {
  const normalized = text.toLowerCase();

  const bannedPatterns = [
    'here are a few options',
    'pick whichever',
    'option a',
    'option b',
    'option c',
    'option d',
    'dry check-in',
    'minimal effort re-engage',
    'self-insert humor',
    'random thought drop',
    'which one do you want',
  ];

  if (bannedPatterns.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  // Guard against markdown option/template dumps.
  if (/\*\*option\s+[a-d]\*\*/i.test(text) || /^>\s*["']?.+["']?\s*$/m.test(text)) {
    return true;
  }

  return false;
}

function isRepetitiveStartReply(mode: z.infer<typeof chatModeSchema>, bubbles: string[]) {
  if (mode !== 'start' || bubbles.length === 0) {
    return false;
  }

  const first = bubbles[0].trim().toLowerCase();
  if (!first) {
    return false;
  }

  const bannedStartPatterns = [
    /^man,\s*did you see/,
    /^hey\s+so\s+i\s+just/,
    /^anybody alive in here/,
    /^you still alive over there/,
    /^just saw\b/,
  ];

  return bannedStartPatterns.some((pattern) => pattern.test(first));
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  return String(error).slice(0, 500);
}

function isMissingPersonaError(error: unknown) {
  const text = toErrorMessage(error).toLowerCase();
  return (
    text.includes('no usable system prompt found') &&
    text.includes('persona_v2.txt') &&
    text.includes('persona.txt')
  );
}

function classifyError(error: unknown) {
  const text = toErrorMessage(error).toLowerCase();

  if (isMissingPersonaError(error)) {
    return 'config';
  }

  if (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('abort') ||
    text.includes('deadline')
  ) {
    return 'timeout';
  }

  if (
    text.includes('network') ||
    text.includes('fetch') ||
    text.includes('econn') ||
    text.includes('enotfound') ||
    text.includes('socket')
  ) {
    return 'network';
  }

  if (
    text.includes('provider returned error') ||
    text.includes('openrouter') ||
    text.includes('rate limit') ||
    text.includes('status code')
  ) {
    return 'provider';
  }

  if (
    text.includes('validation') ||
    text.includes('invalid') ||
    text.includes('no response generated') ||
    text.includes('no bubbles generated') ||
    text.includes('json')
  ) {
    return 'validation';
  }

  return 'unknown';
}

function isRetryableErrorClass(errorClass: string) {
  return errorClass === 'provider' || errorClass === 'network' || errorClass === 'timeout';
}

async function appendLlmErrorEvent({
  requestId,
  mode,
  stage,
  attempt,
  errorClass,
  errorMessage,
}: {
  requestId: string;
  mode: z.infer<typeof chatModeSchema>;
  stage: 'generateText' | 'output_check';
  attempt: number;
  errorClass: string;
  errorMessage: string;
}) {
  await appendConversationLog({
    ts: new Date().toISOString(),
    type: 'llm_error',
    requestId,
    mode,
    stage,
    attempt,
    errorClass,
    errorMessage,
  });
}

export async function POST(request: Request) {
  const requestId = makeRequestId();
  const requestStartedAt = Date.now();
  const clientIp = getClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  try {
    const env = getEnv();
    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
    }

    const parsed = chatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
    }

    const { messages, mode } = parsed.data;
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    const lastUserText = lastUser?.text ?? '';

    if (lastUserText.trim()) {
      await appendConversationLog({
        ts: new Date().toISOString(),
        type: 'request',
        requestId,
        mode,
        ip: clientIp,
        userAgent,
        messageCount: messages.length,
        lastUserText,
      });
    }

    if (mode === 'normal') {
      if (!lastUser || !lastUser.text.trim()) {
        return NextResponse.json({ error: 'Message cannot be empty.' }, { status: 400 });
      }

      if (lastUser.text.length > env.TONYBOT_MAX_INPUT_CHARS) {
        return NextResponse.json(
          { error: `Message exceeds ${env.TONYBOT_MAX_INPUT_CHARS} characters.` },
          { status: 400 },
        );
      }
    } else if (messages.length === 0) {
      // Allow empty history for synthetic conversation openers/follow-ups.
    }

    const provider = createOpenRouter({
      apiKey: env.OPENROUTER_API_KEY,
      headers: {
        'X-Title': 'tonybot',
      },
    });

    const systemPrompt = await loadSystemPrompt();
    const modeInstruction = buildModeInstruction(mode);
    const recentAssistant = recentAssistantMessages(messages);
    const recentAssistantBlock =
      recentAssistant.length > 0
        ? `\n\nRecent assistant messages to avoid repeating unless the user explicitly asks:\n${recentAssistant
            .map((value, index) => `${index + 1}. ${value}`)
            .join('\n')}`
        : '';
    const adjustedSystemPrompt = `${systemPrompt}

Formatting rules:
- Do not wrap your full reply in quotation marks.
- Sound like a real text conversation.
- Keep many replies short unless detail is clearly needed.
- Never use the phrase "roll call".
- Vary topics naturally; do not over-focus on any single personal detail.
- Do not proactively mention dogs. Only mention dogs when the user directly asks about dogs or references them first.
- If bath vs shower preference comes up, you prefer baths and should not claim to prefer showers.
- Avoid reusing phrases or repeating the same topic from your recent assistant messages unless the user asks to continue that topic.
- For proactive idle messages, prefer varied everyday topics and avoid defaulting to aviation/disaster content.
- Never mention JSON, schemas, formatting instructions, or technical protocol details in visible chat replies.
- Return 1-4 short text bubbles, each as a separate item in the JSON "bubbles" array.
- If the user sends multiple back-to-back messages, treat them as one ongoing thought and respond naturally.${recentAssistantBlock}`;

    const modelMessages = toModelMessages(messages);
    if (modeInstruction) {
      modelMessages.push({ role: 'user', content: modeInstruction });
    }

    let attemptMessages = modelMessages;
    let acceptedBubbles: string[] | null = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const completion = await generateText({
          model: provider(env.OPENROUTER_MODEL),
          system: adjustedSystemPrompt,
          messages: attemptMessages,
        });
        const candidateText = completion.text.trim();

        if (isMetaOptionsStyleReply(candidateText)) {
          const errorMessage =
            'validation: model returned options/template output instead of in-character chat';

          await appendLlmErrorEvent({
            requestId,
            mode,
            stage: 'output_check',
            attempt,
            errorClass: 'validation',
            errorMessage,
          });

          if (attempt >= 3) {
            throw new Error(errorMessage);
          }

          attemptMessages = [
            ...modelMessages,
            {
              role: 'user',
              content:
                'Stay fully in character as Tony. Reply with actual chat messages only. Do not present options, templates, labels, or meta commentary.',
            },
          ];
          continue;
        }

        const candidateBubbles = extractBubblesFromFallback(candidateText);
        if (isRepetitiveStartReply(mode, candidateBubbles)) {
          const errorMessage = 'validation: repetitive start opener style detected';

          await appendLlmErrorEvent({
            requestId,
            mode,
            stage: 'output_check',
            attempt,
            errorClass: 'validation',
            errorMessage,
          });

          if (attempt >= 3) {
            throw new Error(errorMessage);
          }

          attemptMessages = [
            ...modelMessages,
            {
              role: 'user',
              content:
                'Rewrite with a fresh opener and different sentence structure. Avoid "Man, did you see..." and other canned lead-ins.',
            },
          ];
          continue;
        }

        acceptedBubbles = candidateBubbles;
        break;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        const errorClass = classifyError(error);

        await appendLlmErrorEvent({
          requestId,
          mode,
          stage: 'generateText',
          attempt,
          errorClass,
          errorMessage,
        });

        const shouldRetry = attempt < 3 && isRetryableErrorClass(errorClass);
        if (!shouldRetry) {
          throw error;
        }

        const retryDelayMs = 250 + Math.floor(Math.random() * 350);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    if (!acceptedBubbles) {
      throw new Error('validation: No response generated.');
    }

    if (acceptedBubbles.length === 0) {
      throw new Error('validation: No bubbles generated.');
    }

    await appendConversationLog({
      ts: new Date().toISOString(),
      type: 'response',
      requestId,
      mode,
      status: 'ok',
      path: 'text',
      durationMs: Date.now() - requestStartedAt,
      ip: clientIp,
      userAgent,
      bubbles: acceptedBubbles,
    });

    return NextResponse.json({
      assistant: {
        bubbles: acceptedBubbles,
      },
      meta: { proactiveEligible: true },
    });
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    const errorClass = classifyError(error);

    await appendConversationLog({
      ts: new Date().toISOString(),
      type: 'response',
      requestId,
      status: 'error',
      durationMs: Date.now() - requestStartedAt,
      ip: clientIp,
      userAgent,
      errorClass,
      errorMessage,
    });

    const fallbackBubbles = isMissingPersonaError(error)
      ? ['Setup issue: add persona_v2.txt or persona.txt to the project root, then reload the app.']
      : ['One sec, had a hiccup. Try that again?'];

    return NextResponse.json({
      assistant: {
        bubbles: fallbackBubbles,
      },
      meta: { proactiveEligible: false },
    });
  }
}
