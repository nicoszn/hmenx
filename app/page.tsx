"use client";

import { useEffect, useState } from "react";
import TurnInput from "@/components/hmem/TurnInput";
import LogStream from "@/components/hmem/LogStream";
import GraphView from "@/components/hmem/GraphView";
import WorkspaceBoard from "@/components/hmem/WorkspaceBoard";
import ScoreGauge from "@/components/hmem/ScoreGauge";
import SkillVersionPanel from "@/components/hmem/SkillVersionPanel";
import type { GraphEdge, GraphNode, TurnEvent, WorkspaceEntry } from "@/lib/hmem/types";

const SESSION_KEY = "hmem-session-id";

async function refreshSnapshot(sessionId: string) {
  const res = await fetch(`/api/hmem/session/${sessionId}`);
  return res.json() as Promise<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    workspace: WorkspaceEntry[];
    pruneThreshold: number;
  }>;
}

export default function Page() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceEntry[]>([]);
  const [coherence, setCoherence] = useState<number | null>(null);
  const [pruneThreshold, setPruneThreshold] = useState(0.35);

  useEffect(() => {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    setSessionId(id);
    refreshSnapshot(id).then((snap) => {
      setNodes(snap.nodes);
      setEdges(snap.edges);
      setWorkspace(snap.workspace);
      setPruneThreshold(snap.pruneThreshold);
    });
  }, []);

  async function handleSubmit(agentId: string, text: string) {
    if (!sessionId) return;
    setBusy(true);
    setStreamingText("");
    setLogLines((prev) => [...prev, `> ${agentId}: ${text}`]);

    const res = await fetch(`/api/hmem/session/${sessionId}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, text }),
    });

    if (!res.body) {
      setLogLines((prev) => [...prev, "# error: no response stream"]);
      setBusy(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as TurnEvent;
        applyEvent(event);
      }
    }

    function applyEvent(event: TurnEvent) {
      switch (event.kind) {
        case "status":
          setLogLines((prev) => [...prev, `# ${event.message}`]);
          break;
        case "token":
          setStreamingText((prev) => prev + event.text);
          break;
        case "node-inserted":
          setLogLines((prev) => [
            ...prev,
            `# node ${event.merged ? "merged into" : "created"}: ${event.node.label}`,
          ]);
          break;
        case "workspace-posted":
          setLogLines((prev) => [...prev, `# [${event.entry.agentId}] posted to workspace`]);
          break;
        case "score":
          setCoherence(event.coherence);
          setPruneThreshold(event.pruneThreshold);
          setLogLines((prev) => [
            ...prev,
            `# coherence ${event.coherence.toFixed(2)} -> threshold ${event.pruneThreshold.toFixed(2)}`,
          ]);
          break;
        case "done":
          setLogLines((prev) => [...prev, `assistant: ${event.narrative}`]);
          setStreamingText("");
          break;
        case "error":
          setLogLines((prev) => [...prev, `# error: ${event.message}`]);
          break;
      }
    }

    setBusy(false);
    if (sessionId) {
      const snap = await refreshSnapshot(sessionId);
      setNodes(snap.nodes);
      setEdges(snap.edges);
      setWorkspace(snap.workspace);
    }
  }

  return (
    <main className="min-h-screen p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-lg font-mono text-ink">HMEM — memory sandbox</h1>
        <p className="text-xs text-muted">
          session <span className="font-mono">{sessionId ?? "…"}</span>
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4">
        <section className="flex flex-col gap-4">
          <TurnInput disabled={busy} onSubmit={handleSubmit} />
          <LogStream lines={logLines} streaming={streamingText} />
        </section>

        <aside className="flex flex-col gap-4">
          <ScoreGauge coherence={coherence} pruneThreshold={pruneThreshold} />
          <GraphView nodes={nodes} edges={edges} />
          <WorkspaceBoard entries={workspace} />
          <SkillVersionPanel />
        </aside>
      </div>
    </main>
  );
}
