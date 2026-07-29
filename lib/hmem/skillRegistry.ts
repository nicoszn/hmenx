import { sql } from "./db";
import { cosineSimilarity, embed } from "./embeddings";
import { buildSystemPrompt, parseResponse, streamCompletion, type PromptConfig } from "./promptBuilder";
import type { SkillMetrics, SkillVersion } from "./types";

const EPSILON = 0.01; // floating-point tolerance on the Pareto comparison

export async function getActiveVersion(component: string): Promise<SkillVersion | null> {
  const [row] = (await sql`
    select id, component, version, config, metrics, status
    from skill_versions
    where component = ${component} and status = 'active'
    order by version desc
    limit 1
  `) as SkillVersion[];
  return row ?? null;
}

export async function createCandidate(
  component: string,
  config: Record<string, unknown>
): Promise<SkillVersion> {
  const [{ maxVersion }] = (await sql`
    select coalesce(max(version), 0) as "maxVersion" from skill_versions where component = ${component}
  `) as { maxVersion: number }[];

  const [row] = (await sql`
    insert into skill_versions (component, version, config, status)
    values (${component}, ${maxVersion + 1}, ${JSON.stringify(config)}::jsonb, 'candidate')
    returning id, component, version, config, metrics, status
  `) as SkillVersion[];

  return row;
}

// Runs a candidate promptBuilder config against the fixed regression set and
// computes the three Tier 4 metrics from real execution traces — no
// subjective LLM-as-judge scoring involved, everything here is either a
// cosine similarity or a boolean parse check.
export async function evaluatePromptBuilderCandidate(
  config: PromptConfig
): Promise<SkillMetrics> {
  const rows = (await sql`
    select input, context, target_label as "targetLabel"
    from regression_turns
    where component = 'promptBuilder'
  `) as { input: string; context: string[]; targetLabel: string | null }[];

  if (rows.length === 0) {
    throw new Error(
      "No regression_turns rows for component 'promptBuilder' — seed the regression set before promoting."
    );
  }

  let fidelitySum = 0;
  let driftSum = 0;
  let veracitySum = 0;

  for (const row of rows) {
    const systemPrompt = buildSystemPrompt({
      recentMessages: [],
      tier2Snippets: row.context,
      tier3Nodes: [],
      workspace: [],
      config,
    });

    let raw = "";
    for await (const chunk of streamCompletion(systemPrompt, row.input, config)) {
      raw += chunk;
    }
    const parsed = parseResponse(raw);

    const narrativeEmbedding = await embed(parsed.narrative || row.input);
    const inputEmbedding = await embed(row.input);

    const contextEmbeddings = await Promise.all(row.context.map((c) => embed(c)));
    const fidelity = contextEmbeddings.length
      ? Math.max(...contextEmbeddings.map((e) => cosineSimilarity(narrativeEmbedding, e)))
      : 0.5;

    const drift = 1 - cosineSimilarity(inputEmbedding, narrativeEmbedding);

    fidelitySum += fidelity;
    driftSum += drift;
    veracitySum += parsed.wellFormed ? 1 : 0;
  }

  return {
    contextFidelity: fidelitySum / rows.length,
    semanticDrift: driftSum / rows.length,
    toolExecutionVeracity: veracitySum / rows.length,
  };
}

// Strict Pareto dominance: the candidate is accepted only if it is at least
// as good as the active version on every metric, and strictly better on at
// least one — within a small tolerance for floating-point noise. Note
// semanticDrift is a "lower is better" metric, so its comparison is inverted.
export function isParetoImprovement(candidate: SkillMetrics, active: SkillMetrics): boolean {
  const higherIsBetter: (keyof SkillMetrics)[] = ["contextFidelity", "toolExecutionVeracity"];
  const lowerIsBetter: (keyof SkillMetrics)[] = ["semanticDrift"];

  let strictlyBetterSomewhere = false;

  for (const key of higherIsBetter) {
    const diff = candidate[key] - active[key];
    if (diff < -EPSILON) return false;
    if (diff > EPSILON) strictlyBetterSomewhere = true;
  }
  for (const key of lowerIsBetter) {
    const diff = active[key] - candidate[key]; // inverted: candidate lower is an improvement
    if (diff < -EPSILON) return false;
    if (diff > EPSILON) strictlyBetterSomewhere = true;
  }

  return strictlyBetterSomewhere;
}

export async function promote(
  component: string,
  candidateId: string
): Promise<{ accepted: boolean; metrics: SkillMetrics; reason: string }> {
  const [candidate] = (await sql`
    select id, component, version, config, metrics, status from skill_versions where id = ${candidateId}
  `) as SkillVersion[];
  if (!candidate) throw new Error(`No skill_version found for id ${candidateId}`);

  const metrics =
    component === "promptBuilder"
      ? await evaluatePromptBuilderCandidate(candidate.config as PromptConfig)
      : (() => {
          throw new Error(`No evaluator wired up for component "${component}" yet`);
        })();

  await sql`update skill_versions set metrics = ${JSON.stringify(metrics)}::jsonb where id = ${candidateId}`;

  const active = await getActiveVersion(component);
  if (!active || !active.metrics) {
    // first version for this component — nothing to regress against, promote directly
    await sql`update skill_versions set status = 'active' where id = ${candidateId}`;
    return { accepted: true, metrics, reason: "No active version to compare against — promoted as baseline." };
  }

  const accepted = isParetoImprovement(metrics, active.metrics);

  if (accepted) {
    await sql`update skill_versions set status = 'superseded' where id = ${active.id}`;
    await sql`update skill_versions set status = 'active' where id = ${candidateId}`;
    return { accepted, metrics, reason: "Candidate Pareto-dominates the active version." };
  }

  await sql`update skill_versions set status = 'rejected' where id = ${candidateId}`;
  return {
    accepted,
    metrics,
    reason: "Candidate did not strictly dominate the active version on all metrics — rejected.",
  };
}
