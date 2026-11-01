import type { Random } from '@beepocket/core';

export interface QuizQuestion {
  /** 1-based position in the phrase. */
  position: number;
  options: string[];
  answer: string;
}

function below(random: Random, n: number): number {
  const b = random.bytes(4);
  const v = ((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0);
  return (v >>> 0) % n;
}

function shuffle<T>(random: Random, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = below(random, i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** `count` distinct positions, each asked with the right word and two other words of the phrase. */
export function makeQuiz(random: Random, phrase: string, count = 3): QuizQuestion[] {
  const words = phrase.split(' ');
  const positions = shuffle(
    random,
    words.map((_, i) => i),
  )
    .slice(0, count)
    .sort((a, b) => a - b);
  return positions.map((i) => {
    const answer = words[i] ?? '';
    const decoys = shuffle(
      random,
      [...new Set(words)].filter((w) => w !== answer),
    ).slice(0, 2);
    return { position: i + 1, answer, options: shuffle(random, [answer, ...decoys]) };
  });
}
