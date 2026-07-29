import { cosineSimilarity, embed } from "./embeddings";
import type { GraphNode, ParsedResponse } from "./types";

const IDEAL_LENGTH_RANGE: [number, number] = [40, 400]; // characters — too short = low-info, too long = rambling
const THRESHOLD_STEP = 0.03;
const THRESHOLD_MIN = 0.1;
const THRESHOLD_MAX = 0.6;

function lengthScore(text: string): number {
  const [lo, hi] = IDEAL_LENGTH_RANGE;
  const len = text.length;
  if (len >= lo && len <= hi) return 1;
  if (len < lo) return len / lo;
  return Math.max(0, 1 - (len - hi) / hi);
}

// Rewards output that stays grounded in what the graph already knows,
// penalizes drift into unrelated territory.
async function entityOverlapScore(narrative: string, relatedNodes: GraphNode[]): Promise<number> {
  if (relatedNodes.length === 0) return 0.5; // neutral — nothing to compare against yet
  const narrativeEmbedding = await embed(narrative);
  const sims = await Promise.all(
    relatedNodes.map(async (n) => cosineSimilarity(narrativeEmbedding, await embed(n.label)))
  );
  return Math.max(...sims);
}

// A crude heuristic that silently adjusts system behavior is hard to trust;
// log the score and the resulting threshold move every turn (the caller is
// responsible for emitting that as a 'score' TurnEvent) so it stays
// debuggable rather than becoming invisible internal state.
export async function computeCoherence(
  parsed: ParsedResponse,
  relatedNodes: GraphNode[]
): Promise<number> {
  const lenScore = lengthScore(parsed.narrative);
  const overlapScore = await entityOverlapScore(parsed.narrative, relatedNodes);
  const formednessScore = parsed.wellFormed ? 1 : 0;

  return lenScore * 0.35 + overlapScore * 0.4 + formednessScore * 0.25;
}

// Low coherence -> tighten the threshold (system "loses confidence" faster
// during noisy stretches). High coherence -> relax it.
export function adaptThreshold(current: number, coherence: number): number {
  const direction = coherence >= 0.6 ? -1 : 1; // relax on good turns, tighten on bad ones
  const next = current + direction * THRESHOLD_STEP;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, next));
}
