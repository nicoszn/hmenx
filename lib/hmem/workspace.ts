import { sql } from "./db";
import type { WorkspaceEntry } from "./types";

const MAX_BOARD_ENTRIES = 50;

// Reading happens at the start of every turn, regardless of whether the
// agent posts anything — posting is the deliberate action ([POST ...]),
// reading is unconditional. That split keeps the board's logs legible: you
// can see exactly when and why an agent chose to share something.
export function recentEntries(
  workspace: WorkspaceEntry[],
  limit = 5
): WorkspaceEntry[] {
  return workspace.slice(-limit);
}

export async function postEntry(
  sessionId: string,
  workspace: WorkspaceEntry[],
  entry: WorkspaceEntry
): Promise<WorkspaceEntry[]> {
  const next = [...workspace, entry].slice(-MAX_BOARD_ENTRIES);
  await sql`
    update sessions
    set workspace = ${JSON.stringify(next)}::jsonb, updated_at = now()
    where id = ${sessionId}
  `;
  return next;
}
