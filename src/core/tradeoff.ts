import type { Tradeoff } from './types';

/** Answers needed before the model may settle a pair on its own. */
export const MIN_SAMPLES = 8;
/** Probability the model needs before settling a pair on its own. */
export const AUTO_CONFIDENCE = 0.85;

const ITERATIONS = 300;
const LEARNING_RATE = 0.5;
const L2 = 0.05;

export type Weights = number[];

/** Feature differences between two tasks: [importance, urgency, scarcity]. */
export interface Features {
  /** +1 if A is known to matter more, −1 if less, 0 if unknown. */
  importance: number;
  urgency: number;
  scarcity: number;
}

export function toVector(f: Features): number[] {
  return [f.importance, f.urgency, f.scarcity];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const dot = (w: number[], x: number[]) => w.reduce((s, wi, i) => s + wi * (x[i] ?? 0), 0);

/**
 * Logistic regression without a bias term, so P(A over B) = 1 − P(B over A).
 * Each tradeoff is one sample of "chosen − other" with label 1.
 */
export function train(tradeoffs: Tradeoff[]): Weights {
  const w = [0, 0, 0];
  if (tradeoffs.length === 0) return w;
  for (let it = 0; it < ITERATIONS; it++) {
    const grad = [0, 0, 0];
    for (const t of tradeoffs) {
      const p = sigmoid(dot(w, t.features));
      for (let i = 0; i < w.length; i++) grad[i] += (1 - p) * (t.features[i] ?? 0);
    }
    for (let i = 0; i < w.length; i++) {
      w[i] += LEARNING_RATE * (grad[i] / tradeoffs.length - L2 * w[i]);
    }
  }
  return w;
}

/** Probability the user picks A over B, given A − B features. */
export function predict(w: Weights, diff: number[]): number {
  return sigmoid(dot(w, diff));
}

/** The model's pick, if it is confident enough to skip asking. */
export function autoResolve(w: Weights, samples: number, diff: number[]): 'a' | 'b' | null {
  if (samples < MIN_SAMPLES) return null;
  const p = predict(w, diff);
  if (p >= AUTO_CONFIDENCE) return 'a';
  if (p <= 1 - AUTO_CONFIDENCE) return 'b';
  return null;
}
