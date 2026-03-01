import { promises as fs } from 'node:fs';
import path from 'node:path';

let promptCache: string | undefined;

export async function loadSystemPrompt() {
  if (promptCache) {
    return promptCache;
  }

  const promptCandidates = ['persona_v2.txt', 'persona.txt'];
  let loadedPrompt = '';
  let loadedFrom = '';

  for (const filename of promptCandidates) {
    const promptPath = path.join(process.cwd(), filename);
    try {
      const prompt = await fs.readFile(promptPath, 'utf8');
      const trimmed = prompt.trim();
      if (trimmed) {
        loadedPrompt = trimmed;
        loadedFrom = filename;
        break;
      }
    } catch {
      // Try next candidate.
    }
  }

  promptCache = loadedPrompt;

  if (!promptCache) {
    throw new Error(
      'No usable system prompt found. Expected non-empty persona_v2.txt or persona.txt.',
    );
  }

  if (!loadedFrom) {
    throw new Error('Failed to determine system prompt source file.');
  }

  return promptCache;
}
