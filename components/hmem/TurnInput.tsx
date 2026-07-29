"use client";

import { useState } from "react";

export default function TurnInput({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (agentId: string, text: string) => void;
}) {
  const [agentId, setAgentId] = useState("agent-1");
  const [text, setText] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSubmit(agentId.trim() || "agent-1", text.trim());
    setText("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border border-border bg-panel p-3 rounded-md">
      <div className="flex items-center gap-2">
        <label htmlFor="agentId" className="text-xs text-muted font-mono">
          agent
        </label>
        <input
          id="agentId"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="w-28 bg-base border border-border rounded px-2 py-1 text-xs font-mono text-ink"
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type this agent's turn…"
        rows={3}
        disabled={disabled}
        className="w-full resize-none bg-base border border-border rounded px-3 py-2 text-sm text-ink placeholder:text-muted disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="self-end rounded bg-signal px-4 py-1.5 text-sm font-medium text-base disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {disabled ? "Running…" : "Send turn"}
      </button>
    </form>
  );
}
