export default function ScoreGauge({
  coherence,
  pruneThreshold,
}: {
  coherence: number | null;
  pruneThreshold: number;
}) {
  const markerPct = Math.round((coherence ?? 0) * 100);
  const thresholdPct = Math.round(pruneThreshold * 100);

  return (
    <div className="border border-border bg-panel rounded-md p-3">
      <div className="flex justify-between text-xs font-mono text-muted mb-2">
        <span>coherence</span>
        <span className="text-ink">{coherence === null ? "—" : coherence.toFixed(2)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-base overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-signal transition-all duration-300"
          style={{ width: `${markerPct}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-edge"
          style={{ left: `${thresholdPct}%` }}
          title="adaptive prune threshold"
        />
      </div>
      <div className="flex justify-between text-xs font-mono text-muted mt-2">
        <span>prune threshold</span>
        <span className="text-edge">{pruneThreshold.toFixed(2)}</span>
      </div>
    </div>
  );
}
