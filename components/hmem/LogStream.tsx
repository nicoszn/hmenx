"use client";

import { useEffect, useRef } from "react";

export default function LogStream({ lines, streaming }: { lines: string[]; streaming: string }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, streaming]);

  return (
    <div className="flex flex-col border border-border bg-panel rounded-md p-3 h-72 overflow-y-auto font-mono text-xs">
      {lines.length === 0 && !streaming && (
        <p className="text-muted">Send a turn to start the simulation.</p>
      )}
      {lines.map((line, i) => (
        <p key={i} className="text-muted whitespace-pre-wrap leading-relaxed">
          {line}
        </p>
      ))}
      {streaming && <p className="text-ink whitespace-pre-wrap leading-relaxed">{streaming}</p>}
      <div ref={bottomRef} />
    </div>
  );
}
