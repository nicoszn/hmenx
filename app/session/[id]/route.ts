import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/hmem/db";

export const runtime = "nodejs";

// The client generates its own session id (crypto.randomUUID()) and this
// route lazily creates the row on first load — one less endpoint to keep
// in sync with the module layout, and it makes "new session" just "load a
// fresh id" from the client's point of view.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;

  let [session] = (await sql`select * from sessions where id = ${id}`) as any[];

  if (!session) {
    [session] = (await sql`
      insert into sessions (id) values (${id})
      returning *
    `) as any[];
  }

  const nodes = await sql`select id, label from nodes where session_id = ${id} order by created_at asc`;
  const edges = await sql`
    select id, source_id as "sourceId", target_id as "targetId", weight
    from edges where session_id = ${id}
  `;

  return NextResponse.json({
    id: session.id,
    messages: session.messages,
    workspace: session.workspace,
    pruneThreshold: session.prune_threshold,
    nodes,
    edges,
  });
}
