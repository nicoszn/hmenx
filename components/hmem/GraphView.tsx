"use client";

import { useEffect, useRef } from "react";
import type { GraphEdge, GraphNode } from "@/lib/hmem/types";

type Point = { x: number; y: number; vx: number; vy: number };

export default function GraphView({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const positions = useRef<Map<string, Point>>(new Map());
  const frame = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // seed positions for any node we haven't seen yet
    for (const n of nodes) {
      if (!positions.current.has(n.id)) {
        positions.current.set(n.id, {
          x: width / 2 + (Math.random() - 0.5) * 80,
          y: height / 2 + (Math.random() - 0.5) * 80,
          vx: 0,
          vy: 0,
        });
      }
    }
    // drop positions for nodes that no longer exist (pruned/merged away)
    const liveIds = new Set(nodes.map((n) => n.id));
    for (const id of positions.current.keys()) {
      if (!liveIds.has(id)) positions.current.delete(id);
    }

    function tick() {
      const pos = positions.current;
      const ids = nodes.map((n) => n.id);

      // repulsion between every pair
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos.get(ids[i])!;
          const b = pos.get(ids[j])!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = Math.max(dx * dx + dy * dy, 1);
          const force = 900 / distSq;
          const fx = (dx / Math.sqrt(distSq)) * force;
          const fy = (dy / Math.sqrt(distSq)) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // spring attraction along edges, scaled by weight
      for (const e of edges) {
        const a = pos.get(e.sourceId);
        const b = pos.get(e.targetId);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetLength = 90;
        const force = (dist - targetLength) * 0.02 * (0.4 + e.weight);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // center gravity + integrate + damping
      for (const id of ids) {
        const p = pos.get(id)!;
        p.vx += (width / 2 - p.x) * 0.001;
        p.vy += (height / 2 - p.y) * 0.001;
        p.vx *= 0.85;
        p.vy *= 0.85;
        p.x += p.vx;
        p.y += p.vy;
      }

      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = "#4FD1C5";
      for (const e of edges) {
        const a = pos.get(e.sourceId);
        const b = pos.get(e.targetId);
        if (!a || !b) continue;
        ctx.globalAlpha = 0.25 + e.weight * 0.6;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.font = "10px ui-monospace, monospace";
      for (const n of nodes) {
        const p = pos.get(n.id)!;
        ctx.fillStyle = "#E8A33D";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#8B98A5";
        ctx.fillText(n.label, p.x + 7, p.y + 3);
      }

      frame.current = requestAnimationFrame(tick);
    }

    tick();
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [nodes, edges]);

  return (
    <div className="border border-border bg-panel rounded-md p-2">
      <canvas ref={canvasRef} width={320} height={240} className="w-full h-auto" />
      {nodes.length === 0 && <p className="text-xs text-muted p-2">No concepts extracted yet.</p>}
    </div>
  );
}
