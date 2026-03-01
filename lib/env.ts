import { z } from 'zod';

const serverEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY is required'),
  OPENROUTER_MODEL: z.string().default('anthropic/claude-sonnet-4.6'),
  TONYBOT_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(5000),
});

let cachedEnv: z.infer<typeof serverEnvSchema> | undefined;

export function getEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join(', ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
