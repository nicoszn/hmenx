import type { WorkspaceEntry } from "@/lib/hmem/types";

export default function WorkspaceBoard({ entries }: { entries: WorkspaceEntry[] }) {
  return (
    <div className="border border-border bg-panel rounded-md p-3">
      <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Workspace</h2>
      {entries.length === 0 ? (
        <p className="text-xs text-muted">Nothing posted yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries
            .slice()
            .reverse()
            .map((e, i) => (
              <li key={i} className="text-xs">
                <span className="text-edge font-mono">{e.agentId}</span>{" "}
                <span className="text-ink">{e.note}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
