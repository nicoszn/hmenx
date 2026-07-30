import { NextRequest } from "next/server";
import { sql, toVectorLiteral } from "@/lib/hmem/db";
import { embed } from "@/lib/hmem/embeddings";
import { insertOrMergeNode, upsertEdge, weightedBestFirst, consolidate } from "@/lib/hmem/graphTraversal";
import { postEntry, recentEntries } from "@/lib/hmem/workspace";
import { buildSystemPrompt, parseResponse, streamCompletion, DEFAULT_PROMPT_CONFIG, type PromptConfig } from "@/lib/hmem/promptBuilder";
import { adaptThreshold, computeCoherence } from "@/lib/hmem/scoring";
import { getActiveVersion } from "@/lib/hmem/skillRegistry";
import type { GraphNode, Message, TurnEvent, WorkspaceEntry } from "@/lib/hmem/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// K_local is expressed as a message count rather than a token count — a
// tokenizer dependency isn't worth the added weight for a sliding window
// this small; message count is a reasonable stand-in.
const K_LOCAL = 12;
const TIER2_TOP_K = 3;

function send(controller: ReadableStreamDefaultController<Uint8Array>, event: TurnEvent) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const { agentId, text } = (await req.json()) as { agentId: string; text: string };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const [session] = (await sql`select * from sessions where id = ${sessionId}`) as any[];
        if (!session) {
          send(controller, { kind: "error", message: `Unknown session ${sessionId}` });
          controller.close();
          return;
        }

        let messages: Message[] = session.messages;
        let workspace: WorkspaceEntry[] = session.workspace;
        const turn = messages.length + 1;
        messages = [...messages, { turn, agentId, role: "user", text }];

        // Tier 1 eviction: push the oldest slice up to Tier 2 once the
        // scratchpad exceeds its local capacity.
        if (messages.length > K_LOCAL) {
          const evicted = messages.slice(0, messages.length - K_LOCAL);
          messages = messages.slice(messages.length - K_LOCAL);
          for (const m of evicted) {
            const vector = await embed(m.text);
            await sql`
              insert into embeddings (session_id, content, vector, source_turn)
              values (${sessionId}, ${m.text}, ${toVectorLiteral(vector)}::vector, ${m.turn})
            `;
          }
        }

        send(controller, { kind: "status", message: "retrieving context" });

        // Tier 2 retrieval — top-k by cosine similarity via pgvector
        const queryEmbedding = await embed(text);
        const queryVec = toVectorLiteral(queryEmbedding);
        const tier2Rows = (await sql`
          select content from embeddings
          where session_id = ${sessionId}
          order by vector <=> ${queryVec}::vector
          limit ${TIER2_TOP_K}
        `) as { content: string }[];
        const tier2Snippets = tier2Rows.map((r) => r.content);

        // Tier 3 retrieval — weighted best-first from the last concept node
        const tier3Nodes: GraphNode[] = session.last_node_id
          ? await weightedBestFirst(sessionId, session.last_node_id, session.prune_threshold, 3)
          : [];

        const workspaceContext = recentEntries(workspace, 5);

        // Tier 4 — use the currently active promptBuilder config, if one has been promoted
        const activeSkill = await getActiveVersion("promptBuilder");
        const promptConfig: PromptConfig = (activeSkill?.config as PromptConfig) ?? DEFAULT_PROMPT_CONFIG;

        const systemPrompt = buildSystemPrompt({
          recentMessages: messages.slice(-6),
          tier2Snippets,
          tier3Nodes,
          workspace: workspaceContext,
          config: promptConfig,
        });

        send(controller, { kind: "status", message: "generating" });

        let raw = "";
        for await (const delta of streamCompletion(systemPrompt, text, promptConfig)) {
          raw += delta;
          send(controller, { kind: "token", text: delta });
        }

        const parsed = parseResponse(raw);
        messages = [...messages, { turn: turn + 1, agentId: "assistant", role: "assistant", text: parsed.narrative }];

        // Coherence is computed once per turn and reused both as the new
        // edge's weight and as the adaptive-threshold signal.
        const coherence = await computeCoherence(parsed, tier3Nodes);

        // Apply actions: NODE (Tier 3 insert + edge from the previous node), POST (Workspace)
        let newLastNodeId: string | null = session.last_node_id;
        const nodeAction = parsed.actions.find((a) => a.type === "NODE");
        if (nodeAction && nodeAction.type === "NODE") {
          const nodeEmbedding = await embed(nodeAction.label);
          const { node, merged } = await insertOrMergeNode(sessionId, nodeAction.label, nodeEmbedding);
          send(controller, { kind: "node-inserted", node, merged });

          if (session.last_node_id && session.last_node_id !== node.id) {
            await upsertEdge(sessionId, session.last_node_id, node.id, coherence);
          }
          newLastNodeId = node.id;
        }

        for (const action of parsed.actions) {
          if (action.type !== "POST") continue;
          const entry: WorkspaceEntry = { agentId, timestamp: new Date().toISOString(), note: action.note };
          workspace = await postEntry(sessionId, workspace, entry);
          send(controller, { kind: "workspace-posted", entry });
        }

        const nextThreshold = adaptThreshold(session.prune_threshold, coherence);
        send(controller, { kind: "score", coherence, pruneThreshold: nextThreshold });

        await sql`
          update sessions
          set messages = ${JSON.stringify(messages)}::jsonb,
              last_node_id = ${newLastNodeId},
              prune_threshold = ${nextThreshold},
              updated_at = now()
          where id = ${sessionId}
        `;

        await consolidate(sessionId, nextThreshold);

        send(controller, { kind: "done", narrative: parsed.narrative, actions: parsed.actions });
      } catch (err) {
        send(controller, { kind: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
