export type Message = {
  turn: number;
  agentId: string;
  role: "user" | "assistant";
  text: string;
};

export type WorkspaceEntry = {
  agentId: string;
  timestamp: string;
  note: string;
};

export type GraphNode = {
  id: string;
  label: string;
};

export type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  weight: number;
};

export type ParsedAction =
  | { type: "MOVE"; target: string }
  | { type: "USE"; target: string }
  | { type: "POST"; note: string }
  | { type: "NODE"; label: string };

export type ParsedResponse = {
  narrative: string;
  actions: ParsedAction[];
  wellFormed: boolean;
};

// Every event pushed down the turn stream. The client tells these apart by `kind`.
export type TurnEvent =
  | { kind: "status"; message: string }
  | { kind: "token"; text: string }
  | { kind: "node-inserted"; node: GraphNode; merged: boolean }
  | { kind: "workspace-posted"; entry: WorkspaceEntry }
  | { kind: "score"; coherence: number; pruneThreshold: number }
  | { kind: "done"; narrative: string; actions: ParsedAction[] }
  | { kind: "error"; message: string };

export type SkillMetrics = {
  contextFidelity: number;
  semanticDrift: number;
  toolExecutionVeracity: number;
};

export type SkillVersion = {
  id: string;
  component: string;
  version: number;
  config: Record<string, unknown>;
  metrics: SkillMetrics | null;
  status: "candidate" | "active" | "rejected" | "superseded";
};
