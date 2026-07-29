import { parseVectorLiteral, sql, toVectorLiteral } from "./db";
import { cosineSimilarity } from "./embeddings";
import type { GraphEdge, GraphNode } from "./types";

const MERGE_THRESHOLD = 0.88; // near-duplicate concepts get merged, not fragmented
const DEFAULT_PRUNE_THRESHOLD = 0.15;

type NodeRow = { id: string; label: string; embedding: number[] };

// Before inserting a new node, check for a near-duplicate ("key" vs "bronze
// key" vs "the bronze key I found") and merge into it instead of
// fragmenting the graph. Only possible because embeddings now carry real
// meaning — this is a near-free upgrade once Tier 2 is real.
export async function insertOrMergeNode(
  sessionId: string,
  label: string,
  embedding: number[]
): Promise<{ node: GraphNode; merged: boolean }> {
  const vec = toVectorLiteral(embedding);
  const candidates = (await sql`
    select id, label, 1 - (embedding <=> ${vec}::vector) as similarity
    from nodes
    where session_id = ${sessionId}
    order by embedding <=> ${vec}::vector
    limit 1
  `) as { id: string; label: string; similarity: number }[];

  if (candidates.length > 0 && Number(candidates[0].similarity) >= MERGE_THRESHOLD) {
    return { node: { id: candidates[0].id, label: candidates[0].label }, merged: true };
  }

  const [row] = (await sql`
    insert into nodes (session_id, label, embedding)
    values (${sessionId}, ${label}, ${vec}::vector)
    returning id, label
  `) as { id: string; label: string }[];

  return { node: { id: row.id, label: row.label }, merged: false };
}

// Combine duplicate edge weights with an asymptotic-summation function
// (repeated confirmation of the same relationship should raise confidence
// but never exceed 1): w_new = 1 - Π(1 - w_k).
export async function upsertEdge(
  sessionId: string,
  sourceId: string,
  targetId: string,
  weight: number
): Promise<void> {
  const [existing] = (await sql`
    select id, weight from edges
    where session_id = ${sessionId} and source_id = ${sourceId} and target_id = ${targetId}
  `) as { id: string; weight: number }[];

  if (existing) {
    const merged = 1 - (1 - existing.weight) * (1 - weight);
    await sql`update edges set weight = ${merged}, updated_at = now() where id = ${existing.id}`;
    return;
  }

  await sql`
    insert into edges (session_id, source_id, target_id, weight)
    values (${sessionId}, ${sourceId}, ${targetId}, ${weight})
  `;
}

// Weighted best-first search from the current turn's node: nearest by
// connection strength, not hop count. A small priority-queue variant of
// Dijkstra — only follows edges above `threshold`, returns the top `k`
// most strongly related nodes.
export async function weightedBestFirst(
  sessionId: string,
  startNodeId: string,
  threshold: number,
  k = 3
): Promise<GraphNode[]> {
  const edges = (await sql`
    select id, source_id as "sourceId", target_id as "targetId", weight
    from edges
    where session_id = ${sessionId} and weight >= ${threshold}
  `) as GraphEdge[];

  const nodesById = new Map<string, GraphNode>();
  const rows = (await sql`
    select id, label from nodes where session_id = ${sessionId}
  `) as GraphNode[];
  for (const n of rows) nodesById.set(n.id, n);

  const adjacency = new Map<string, { neighbor: string; weight: number }[]>();
  for (const e of edges) {
    if (!adjacency.has(e.sourceId)) adjacency.set(e.sourceId, []);
    if (!adjacency.has(e.targetId)) adjacency.set(e.targetId, []);
    adjacency.get(e.sourceId)!.push({ neighbor: e.targetId, weight: e.weight });
    adjacency.get(e.targetId)!.push({ neighbor: e.sourceId, weight: e.weight });
  }

  // priority queue of [cumulativeStrength, nodeId], strength decays
  // multiplicatively per hop so a strong direct neighbor always outranks
  // a long chain of weak ones.
  const visited = new Set<string>([startNodeId]);
  const frontier: { nodeId: string; strength: number }[] = [
    { nodeId: startNodeId, strength: 1 },
  ];
  const ranked: { node: GraphNode; strength: number }[] = [];

  while (frontier.length > 0) {
    frontier.sort((a, b) => b.strength - a.strength);
    const current = frontier.shift()!;
    const neighbors = adjacency.get(current.nodeId) ?? [];
    for (const { neighbor, weight } of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      const strength = current.strength * weight;
      const node = nodesById.get(neighbor);
      if (node) ranked.push({ node, strength });
      frontier.push({ nodeId: neighbor, strength });
    }
  }

  return ranked
    .sort((a, b) => b.strength - a.strength)
    .slice(0, k)
    .map((r) => r.node);
}

// Background-style maintenance: merge near-duplicate nodes, consolidate
// their edges, and prune edges that have fallen below the (adaptive)
// prune threshold. Session graphs are small, so an O(n^2) pairwise pass is
// fine to run inline at the end of a turn rather than on a worker.
export async function consolidate(
  sessionId: string,
  pruneThreshold = DEFAULT_PRUNE_THRESHOLD
): Promise<void> {
  const rawNodes = (await sql`
    select id, label, embedding from nodes where session_id = ${sessionId}
  `) as { id: string; label: string; embedding: string | number[] }[];
  const nodes: NodeRow[] = rawNodes.map((n) => ({
    id: n.id,
    label: n.label,
    embedding: parseVectorLiteral(n.embedding),
  }));

  const mergedInto = new Map<string, string>(); // duplicateId -> survivorId
  for (let i = 0; i < nodes.length; i++) {
    if (mergedInto.has(nodes[i].id)) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      if (mergedInto.has(nodes[j].id)) continue;
      const sim = cosineSimilarity(nodes[i].embedding, nodes[j].embedding);
      if (sim >= MERGE_THRESHOLD) mergedInto.set(nodes[j].id, nodes[i].id);
    }
  }

  for (const [duplicateId, survivorId] of mergedInto) {
    await sql`update edges set source_id = ${survivorId} where source_id = ${duplicateId}`;
    await sql`update edges set target_id = ${survivorId} where target_id = ${duplicateId}`;
    await sql`delete from nodes where id = ${duplicateId}`;
  }

  await sql`delete from edges where session_id = ${sessionId} and weight < ${pruneThreshold}`;

  // isolated nodes (no remaining edges either direction) are dropped
  await sql`
    delete from nodes
    where session_id = ${sessionId}
      and id not in (select source_id from edges where session_id = ${sessionId})
      and id not in (select target_id from edges where session_id = ${sessionId})
  `;
}
