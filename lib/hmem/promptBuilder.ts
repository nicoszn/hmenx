import OpenAI from "openai";
import type { GraphNode, Message, ParsedAction, ParsedResponse, WorkspaceEntry } from "./types";

export type PromptConfig = {
  temperature: number;
  extraInstructions?: string;
};

export const DEFAULT_PROMPT_CONFIG: PromptConfig = { temperature: 0.4 };

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const TOOL_VOCAB = `Reason about the turn first, in plain prose. Then, on new lines, emit zero or
more actions from this fixed vocabulary — nothing else counts as an action:
  [MOVE <target>]        move to / focus on <target>
  [USE <target>]         use or reference <target>
  [POST "<note>"]        share <note> on the shared Workspace board (only when it's worth other agents seeing)
  [NODE "<label>"]       the single concept this turn is really about — always emit exactly one`;

export function buildSystemPrompt(context: {
  recentMessages: Message[];
  tier2Snippets: string[];
  tier3Nodes: GraphNode[];
  workspace: WorkspaceEntry[];
  config: PromptConfig;
}): string {
  const { recentMessages, tier2Snippets, tier3Nodes, workspace, config } = context;

  const historyBlock = recentMessages
    .map((m) => `${m.agentId} (${m.role}): ${m.text}`)
    .join("\n");

  const retrievedBlock = tier2Snippets.length
    ? tier2Snippets.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : "(none yet)";

  const relatedBlock = tier3Nodes.length
    ? tier3Nodes.map((n) => `- ${n.label}`).join("\n")
    : "(none yet)";

  const workspaceBlock = workspace.length
    ? workspace.map((w) => `[${w.agentId}] ${w.note}`).join("\n")
    : "(empty)";

  return `You are an agent inside a persistent multi-agent memory simulation.

Recent turns:
${historyBlock || "(this is the first turn)"}

Retrieved related memory (Tier 2 — semantic similarity):
${retrievedBlock}

Related concepts (Tier 3 — graph, strongest connections):
${relatedBlock}

Shared Workspace board (posted by other agents):
${workspaceBlock}

${TOOL_VOCAB}
${config.extraInstructions ?? ""}`.trim();
}

export async function* streamCompletion(
  systemPrompt: string,
  userText: string,
  config: PromptConfig
): AsyncGenerator<string> {
  const model = process.env.HMEM_MODEL ?? "anthropic/claude-3.5-sonnet";
  const stream = await client.chat.completions.create({
    model,
    temperature: config.temperature,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

const NODE_RE = /\[NODE\s+"([^"]+)"\]/i;
const POST_RE = /\[POST\s+"([^"]+)"\]/gi;
const MOVE_RE = /\[MOVE\s+([^\]]+)\]/gi;
const USE_RE = /\[USE\s+([^\]]+)\]/gi;
const ANY_TOKEN_RE = /\[[A-Z]+[^\]]*\]/g;

export function parseResponse(raw: string): ParsedResponse {
  const actions: ParsedAction[] = [];

  const nodeMatch = raw.match(NODE_RE);
  if (nodeMatch) actions.push({ type: "NODE", label: nodeMatch[1].trim() });

  for (const m of raw.matchAll(POST_RE)) actions.push({ type: "POST", note: m[1].trim() });
  for (const m of raw.matchAll(MOVE_RE)) actions.push({ type: "MOVE", target: m[1].trim() });
  for (const m of raw.matchAll(USE_RE)) actions.push({ type: "USE", target: m[1].trim() });

  const narrative = raw.replace(ANY_TOKEN_RE, "").trim();

  // well-formed = every bracketed token in the raw text matched one of the
  // four known patterns, and exactly one NODE was emitted, as required.
  const totalTokens = (raw.match(ANY_TOKEN_RE) ?? []).length;
  const wellFormed = Boolean(nodeMatch) && totalTokens === actions.length;

  return { narrative, actions, wellFormed };
}
