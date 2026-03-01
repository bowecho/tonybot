'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

type ChatMode = 'normal' | 'start' | 'idle';

type DisplayMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type OutboundTask = {
  mode: ChatMode;
  proactive: boolean;
};

type ChatApiResponse = {
  assistant: {
    bubbles: string[];
  };
  meta?: {
    proactiveEligible?: boolean;
  };
};

const MIN_IDLE_MS = 12_000;
const MAX_IDLE_MS = 45_000;
const ACTIVITY_THROTTLE_MS = 900;

function nowMs() {
  return Date.now();
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function typingDelayMsForText(text: string) {
  const charsPerSecond = randomBetween(4, 9);
  const ms = 850 + (text.length / charsPerSecond) * 1000;
  return Math.max(900, Math.min(ms, 8000));
}

function interBubblePauseMs() {
  return randomBetween(300, 1100);
}

function normalizeBubbles(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [] as string[];
  }

  return raw
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .slice(0, 4);
}

export default function Home() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const messagesRef = useRef<DisplayMessage[]>([]);
  const outboundQueueRef = useRef<OutboundTask[]>([]);
  const processingRef = useRef(false);
  const idleTimeoutRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const startedRef = useRef(false);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const lastActivityRef = useRef(nowMs());
  const lastAssistantLengthRef = useRef(0);
  const lastEventWasProactiveRef = useRef(false);
  const consecutiveProactiveCountRef = useRef(0);
  const isRequestingRef = useRef(false);
  const isTypingRef = useRef(false);
  const lastActivitySignalRef = useRef(0);

  const appendMessage = useCallback((role: DisplayMessage['role'], text: string) => {
    const message: DisplayMessage = { id: makeId(), role, text };
    messagesRef.current = [...messagesRef.current, message];
    setMessages(messagesRef.current);
  }, []);

  const computeNextProactiveDelay = useCallback(() => {
    let delay = randomBetween(MIN_IDLE_MS, MAX_IDLE_MS);

    if (lastAssistantLengthRef.current > 220) {
      delay += randomBetween(5000, 11000);
    }

    if (lastEventWasProactiveRef.current) {
      delay += randomBetween(12000, 22000);
    }

    if (consecutiveProactiveCountRef.current >= 2) {
      delay += randomBetween(15000, 28000);
    } else if (consecutiveProactiveCountRef.current === 1) {
      delay += randomBetween(7000, 14000);
    }

    return Math.min(delay, 90_000);
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimeoutRef.current !== null) {
      window.clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
  }, []);

  const runQueue = useCallback(async () => {
    if (processingRef.current) {
      return;
    }

    processingRef.current = true;

    try {
      while (outboundQueueRef.current.length > 0 && !unmountedRef.current) {
        const task = outboundQueueRef.current.shift();
        if (!task) {
          continue;
        }

        const payload = {
          mode: task.mode,
          messages: messagesRef.current.map((message) => ({
            role: message.role,
            text: message.text,
          })),
        };

        setError(null);
        setIsRequesting(true);

        let bubbles: string[] = [];

        try {
          const sendRequest = async () => {
            const response = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            if (!response.ok) {
              throw new Error('Request failed');
            }

            const data = (await response.json()) as ChatApiResponse;
            const parsedBubbles = normalizeBubbles(data?.assistant?.bubbles);
            if (parsedBubbles.length === 0) {
              throw new Error('No bubbles returned');
            }

            return parsedBubbles;
          };

          try {
            bubbles = await sendRequest();
          } catch {
            await sleep(450);
            bubbles = await sendRequest();
          }
        } catch {
          if (!task.proactive) {
            setError('Something went wrong. Try again.');
          }
          continue;
        } finally {
          setIsRequesting(false);
        }

        for (let i = 0; i < bubbles.length; i += 1) {
          const bubble = bubbles[i];
          if (!bubble || unmountedRef.current) {
            continue;
          }

          setIsTyping(true);
          await sleep(typingDelayMsForText(bubble));
          if (unmountedRef.current) {
            return;
          }

          setIsTyping(false);
          appendMessage('assistant', bubble);
          lastAssistantLengthRef.current = bubble.length;
          lastActivityRef.current = nowMs();

          if (i < bubbles.length - 1) {
            await sleep(interBubblePauseMs());
          }
        }

        lastEventWasProactiveRef.current = task.proactive;
        if (task.proactive) {
          consecutiveProactiveCountRef.current += 1;
        } else {
          consecutiveProactiveCountRef.current = 0;
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [appendMessage]);

  const scheduleProactive = useCallback(() => {
    clearIdleTimer();

    const delay = computeNextProactiveDelay();
    idleTimeoutRef.current = window.setTimeout(async () => {
      if (unmountedRef.current) {
        return;
      }

      if (
        document.hidden ||
        processingRef.current ||
        isRequestingRef.current ||
        isTypingRef.current
      ) {
        scheduleProactive();
        return;
      }

      const elapsed = nowMs() - lastActivityRef.current;
      if (elapsed < delay) {
        scheduleProactive();
        return;
      }

      outboundQueueRef.current.push({ mode: 'idle', proactive: true });
      await runQueue();
      scheduleProactive();
    }, delay);
  }, [clearIdleTimer, computeNextProactiveDelay, runQueue]);

  const markUserActivity = useCallback(() => {
    lastActivityRef.current = nowMs();
    consecutiveProactiveCountRef.current = 0;
    lastEventWasProactiveRef.current = false;
    scheduleProactive();
  }, [scheduleProactive]);

  const enqueueTask = useCallback(async (task: OutboundTask) => {
    outboundQueueRef.current.push(task);
    await runQueue();
    scheduleProactive();
  }, [runQueue, scheduleProactive]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    appendMessage('user', trimmed);
    setInput('');
    markUserActivity();
    void enqueueTask({ mode: 'normal', proactive: false });
  }

  useEffect(() => {
    isRequestingRef.current = isRequesting;
  }, [isRequesting]);

  useEffect(() => {
    isTypingRef.current = isTyping;
  }, [isTyping]);

  useEffect(() => {
    function onAnyActivity() {
      const now = nowMs();
      if (now - lastActivitySignalRef.current < ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastActivitySignalRef.current = now;
      markUserActivity();
    }

    window.addEventListener('mousemove', onAnyActivity);
    window.addEventListener('keydown', onAnyActivity);
    window.addEventListener('click', onAnyActivity);
    window.addEventListener('focus', onAnyActivity);
    document.addEventListener('visibilitychange', onAnyActivity);

    return () => {
      window.removeEventListener('mousemove', onAnyActivity);
      window.removeEventListener('keydown', onAnyActivity);
      window.removeEventListener('click', onAnyActivity);
      window.removeEventListener('focus', onAnyActivity);
      document.removeEventListener('visibilitychange', onAnyActivity);
    };
  }, [markUserActivity]);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    const timeout = window.setTimeout(() => {
      void enqueueTask({ mode: 'start', proactive: false });
    }, 700);

    scheduleProactive();

    return () => {
      window.clearTimeout(timeout);
      clearIdleTimer();
      unmountedRef.current = true;
    };
  }, [clearIdleTimer, enqueueTask, scheduleProactive]);

  useEffect(() => {
    const setAppHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${Math.round(viewportHeight)}px`);
    };

    setAppHeight();
    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', setAppHeight);
    window.visualViewport?.addEventListener('resize', setAppHeight);
    window.visualViewport?.addEventListener('scroll', setAppHeight);

    return () => {
      window.removeEventListener('resize', setAppHeight);
      window.removeEventListener('orientationchange', setAppHeight);
      window.visualViewport?.removeEventListener('resize', setAppHeight);
      window.visualViewport?.removeEventListener('scroll', setAppHeight);
    };
  }, []);

  const showTypingIndicator = isRequesting || isTyping;

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, showTypingIndicator]);

  return (
    <main className="shell">
      <section className="panel">
        <header className="header">
          <button className="nav-btn" type="button" aria-label="Back">
            ‹
          </button>
          <div className="contact">
            <div className="avatar" aria-hidden="true">
              T
            </div>
            <div>
              <h1>Tony</h1>
              <p className="presence">iMessage</p>
            </div>
          </div>
          <button className="nav-btn" type="button" aria-label="Info">
            i
          </button>
        </header>

        <div className="messages" aria-live="polite">
          {messages.map((message) => (
            <article key={message.id} className={`bubble ${message.role === 'user' ? 'user' : 'assistant'}`}>
              {message.text}
            </article>
          ))}
          {showTypingIndicator && (
            <div className="typing-bubble" aria-label="Tony is typing">
              <span />
              <span />
              <span />
            </div>
          )}
          <div ref={endOfMessagesRef} />
        </div>

        {error ? <p className="error">{error}</p> : null}

        <form className="composer" onSubmit={onSubmit}>
          <textarea
            rows={1}
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                const form = event.currentTarget.form;
                if (form) {
                  form.requestSubmit();
                }
              }
            }}
            placeholder="iMessage"
            maxLength={5000}
          />
          <div className="actions">
            <button type="submit" className="primary" disabled={!input.trim()}>
              Send
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
