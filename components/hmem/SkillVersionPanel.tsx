"use client";

import { useState } from "react";

type PromoteResult = {
  version: number;
  accepted: boolean;
  reason: string;
  metrics: { contextFidelity: number; semanticDrift: number; toolExecutionVeracity: number };
};

export default function SkillVersionPanel() {
  const [temperature, setTemperature] = useState(0.4);
  const [extraInstructions, setExtraInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PromoteResult | { error: string } | null>(null);

  async function submit() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/hmem/admin/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          component: "promptBuilder",
          config: { temperature, extraInstructions: extraInstructions || undefined },
        }),
      });
      setResult(await res.json());
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-border bg-panel rounded-md p-3">
      <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
        Tier 4 — candidate promptBuilder version
      </h2>
      <label className="text-xs text-muted block mb-1">temperature: {temperature.toFixed(2)}</label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={temperature}
        onChange={(e) => setTemperature(Number(e.target.value))}
        className="w-full mb-2"
      />
      <textarea
        value={extraInstructions}
        onChange={(e) => setExtraInstructions(e.target.value)}
        placeholder="Extra system-prompt instructions (optional)"
        rows={2}
        className="w-full resize-none bg-base border border-border rounded px-2 py-1 text-xs text-ink placeholder:text-muted mb-2"
      />
      <button
        onClick={submit}
        disabled={loading}
        className="rounded bg-edge px-3 py-1 text-xs font-medium text-base disabled:opacity-40"
      >
        {loading ? "Evaluating against regression set…" : "Evaluate & promote"}
      </button>

      {result && "error" in result && <p className="text-xs text-danger mt-2">{result.error}</p>}
      {result && "accepted" in result && (
        <div className="text-xs mt-2 font-mono">
          <p className={result.accepted ? "text-signal" : "text-danger"}>
            v{result.version}: {result.accepted ? "ACCEPTED" : "REJECTED"}
          </p>
          <p className="text-muted">{result.reason}</p>
          <p className="text-muted mt-1">
            fidelity {result.metrics.contextFidelity.toFixed(2)} · drift{" "}
            {result.metrics.semanticDrift.toFixed(2)} · veracity{" "}
            {result.metrics.toolExecutionVeracity.toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}
