import { NextRequest, NextResponse } from "next/server";
import { createCandidate, promote } from "@/lib/hmem/skillRegistry";

export const runtime = "nodejs";
export const maxDuration = 60;

// Body: { component: "promptBuilder", config: { temperature: number, extraInstructions?: string } }
// Seed db/schema.sql's `regression_turns` table before calling this — the
// gate has nothing to test the candidate against otherwise.
export async function POST(req: NextRequest) {
  const { component, config } = (await req.json()) as {
    component: string;
    config: Record<string, unknown>;
  };

  if (!component || !config) {
    return NextResponse.json({ error: "component and config are required" }, { status: 400 });
  }

  try {
    const candidate = await createCandidate(component, config);
    const result = await promote(component, candidate.id);
    return NextResponse.json({ version: candidate.version, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
