import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see .env.example");
}

// `sql` is a tagged-template query function: `await sql\`select 1\``.
// No ORM on purpose — the schema is small enough that raw SQL is easier to
// read and audit than a query-builder layer would be.
export const sql = neon(connectionString);

// pgvector expects a literal like "[0.1,0.2,...]" cast to ::vector.
// The Neon driver parameterizes strings safely, so this is injection-safe —
// we're just shaping the value, not concatenating raw SQL.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// The reverse direction: reading a `vector` column back out of the driver
// gives you its literal text form ("[0.1,0.2,...]"), not a parsed array —
// pgvector isn't a type the driver knows how to decode automatically.
export function parseVectorLiteral(value: string | number[]): number[] {
  if (Array.isArray(value)) return value;
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number);
}
