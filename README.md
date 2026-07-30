# HMEM — Interactive Memory Sandbox

Four-tier memory system for a multi-agent LLM simulation, built to run on Vercel:

- **Tier 1** — per-session working memory (sliding turn buffer + shared Workspace board)
- **Tier 2** — vector index cache (`pgvector`, real embeddings via `@huggingface/transformers`)
- **Tier 3** — global semantic graph (weighted best-first retrieval, merge/prune consolidation)
- **Tier 4** — skill/version registry with a Pareto non-regression promotion gate

Stack, as of writing: Next.js 16.2 (App Router, Turbopack default), React 19.2, TypeScript 7
(native Go compiler), Tailwind CSS v4 (CSS-first config, no `tailwind.config.ts`), Node.js 24.
Check `npm outdated` before you deploy — these move fast enough that "current" has a shelf life.

## 1. Set up the database

1. Create a Neon Postgres database — easiest via the Vercel dashboard: **Storage → Create Database → Neon**, or directly at [neon.tech](https://neon.tech).
2. Copy the connection string into `DATABASE_URL`.
3. Run the schema:
   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```
   This enables the `vector` extension and creates all five tables. It's safe to re-run (everything is `create ... if not exists`).

## 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in:
- `DATABASE_URL` — from step 1
- `OPENROUTER_API_KEY` — from [openrouter.ai/keys](https://openrouter.ai/keys)
- `HMEM_MODEL` — any OpenRouter model id, e.g. `anthropic/claude-3.5-sonnet`

## 3. Run locally

Requires Node.js 24+ (`node -v` to check).

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The first turn will be slow (~seconds) — that's `@huggingface/transformers` downloading and caching the embedding model on first use; subsequent turns are fast.

## 4. Seed the Tier 4 regression set (optional, only needed to use the promotion panel)

The "Evaluate & promote" panel has nothing to test a candidate config against until you seed a few fixed turns:

```sql
insert into regression_turns (component, input, context, target_label) values
  ('promptBuilder', 'What did we decide about the room layout?',
   '["The team agreed the entrance faces north.", "Storage room is adjacent to the entrance."]'::jsonb,
   'room layout');
```

Add a handful of representative turns — the more they resemble real sessions, the more meaningful the Pareto comparison is.

## 5. Deploy to Vercel

1. Push this repo to GitHub, import it in Vercel.
2. Add the three environment variables from step 2 in **Project Settings → Environment Variables**.
3. Set the project's Node.js version to 24.x in **Project Settings → General**.
4. Deploy.

Things specific to this stack worth knowing before you deploy:
- Every route that touches embeddings or the LLM call sets `export const runtime = "nodejs"` — required, since `@huggingface/transformers` needs Node APIs and won't run on the Edge runtime.
- The embedding pipeline is pinned to `device: "cpu"` in `lib/hmem/embeddings.ts` — there's no GPU on Vercel's Node runtime, so this skips the library's WebGPU auto-detection rather than relying on it to fall back correctly.
- Dynamic route params (`params` in the two `[id]` route handlers) are typed as a `Promise` and awaited — this has been required since Next.js 15 and remains true in 16; a plain synchronous `params` object will throw.
- `maxDuration` is set to 60s on the turn and promote routes to give the embedding pipeline and streaming completion room to run. If your Vercel plan caps function duration lower than that, either upgrade or reduce `TIER2_TOP_K` / regression-set size in `lib/hmem` to keep runs shorter.
- Tailwind v4 has no `tailwind.config.ts` — design tokens live in `app/globals.css` under `@theme`. If you add new colors or fonts, edit them there, not in a config file.

## Project layout

```
lib/hmem/         all four tiers' logic — no framework code, pure functions + the DB client
app/api/hmem/      three routes: rehydrate session, stream a turn, promote a skill version
components/hmem/   the five UI panes
db/schema.sql      the entire schema, run once
```

No ORM, no state-management library, no background worker — everything runs inline inside the
three route handlers, because Vercel gives you a request/response cycle, not a long-running
process. Consolidation (Tier 3 merge/prune) runs at the end of every turn rather than on a
timer for the same reason.
