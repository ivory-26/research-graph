/**
 * Pure projections for the Overview page's live mode.
 *
 * The page fetches `/api/sources` and `/api/experiments`; everything derived
 * from those rows (KPI counts, the research question, workspace activity and
 * the artifact list) lives here so it can be tested without a browser or a
 * database. Nothing in this module invents a row: an empty workspace produces
 * empty results and the page renders an explicit empty state.
 */

export interface OverviewSourceRow {
  id: string;
  title: string;
  kind: string;
  createdAt: string;
}

export interface OverviewArtifactRow {
  id: string;
  kind: string;
  path: string;
  bytes: number;
}

export interface OverviewRunRow {
  id: string;
  attempt: number;
  status: string;
  verdict: string | null;
  createdAt?: string | null;
  finishedAt?: string | null;
  artifacts: OverviewArtifactRow[];
}

export interface OverviewExperimentRow {
  id: string;
  claimTitle: string;
  claimText: string | null;
  approvalState: string;
  createdAt: string;
  approvedAt?: string | null;
  runs: OverviewRunRow[];
}

export interface OverviewClaimRow {
  id: string;
  title: string;
  text: string | null;
}

export interface OverviewCounts {
  sources: number;
  claims: number;
  runs: number;
}

function timeValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * KPI counts for a live workspace. Claims are the claim nodes the experiments
 * API returns for the workspace (its authoritative claim list); runs are the
 * run rows nested under the persisted experiments.
 */
export function summarizeOverviewCounts(
  sources: OverviewSourceRow[],
  experiments: OverviewExperimentRow[],
  claims: OverviewClaimRow[],
): OverviewCounts {
  return {
    sources: sources.length,
    claims: claims.length,
    runs: experiments.reduce((sum, experiment) => sum + experiment.runs.length, 0),
  };
}

/** The newest experiment, or `null`. The API returns newest first; this does not rely on it. */
export function latestExperiment(
  experiments: OverviewExperimentRow[],
): OverviewExperimentRow | null {
  let latest: OverviewExperimentRow | null = null;
  let latestAt: number | null = null;
  for (const experiment of experiments) {
    const at = timeValue(experiment.createdAt);
    if (!latest || (at !== null && (latestAt === null || at >= latestAt))) {
      latest = experiment;
      latestAt = at;
    }
  }
  return latest;
}

export interface ResearchQuestionView {
  title: string;
  text: string | null;
  from: 'experiment' | 'claim';
}

/**
 * The research question the workspace is built around: the latest persisted
 * experiment's claim, else the first claim node, else `null` (no question).
 */
export function resolveResearchQuestion(
  experiments: OverviewExperimentRow[],
  claims: OverviewClaimRow[],
): ResearchQuestionView | null {
  const experiment = latestExperiment(experiments);
  if (experiment) {
    return { title: experiment.claimTitle, text: experiment.claimText, from: 'experiment' };
  }
  const claim = claims[0] ?? null;
  if (claim) return { title: claim.title, text: claim.text, from: 'claim' };
  return null;
}

export interface OverviewArtifactView {
  id: string;
  kind: string;
  path: string;
  bytes: number;
  runStatus: string;
  runVerdict: string | null;
  attempt: number;
  claimTitle: string;
  at: string | null;
}

/**
 * Flattens `experiments[].runs[].artifacts` into display rows. Order follows
 * the API (newest experiment first, runs by attempt); no timestamp is invented
 * for an artifact that does not carry one.
 */
export function flattenRunArtifacts(
  experiments: OverviewExperimentRow[],
): OverviewArtifactView[] {
  const artifacts: OverviewArtifactView[] = [];
  for (const experiment of experiments) {
    for (const run of experiment.runs) {
      for (const artifact of run.artifacts) {
        artifacts.push({
          id: artifact.id,
          kind: artifact.kind,
          path: artifact.path,
          bytes: artifact.bytes,
          runStatus: run.status,
          runVerdict: run.verdict,
          attempt: run.attempt,
          claimTitle: experiment.claimTitle,
          at: run.finishedAt ?? run.createdAt ?? null,
        });
      }
    }
  }
  return artifacts;
}

export type ActivityTone = 'emerald' | 'orange';

export interface WorkspaceActivityItem {
  key: string;
  title: string;
  detail: string;
  badge: string;
  tone: ActivityTone;
  at: string | null;
}

/**
 * The three most recent things that happened in a live workspace, derived only
 * from source and experiment rows. A workspace with no rows gets no items.
 */
export function buildWorkspaceActivity(
  sources: OverviewSourceRow[],
  experiments: OverviewExperimentRow[],
): WorkspaceActivityItem[] {
  const items: WorkspaceActivityItem[] = [];

  let latestSource: { source: OverviewSourceRow; at: number | null } | null = null;
  for (const source of sources) {
    const at = timeValue(source.createdAt);
    if (!latestSource || (at !== null && (latestSource.at === null || at >= latestSource.at))) {
      latestSource = { source, at };
    }
  }
  if (latestSource) {
    items.push({
      key: `source:${latestSource.source.id}`,
      title: 'Source ingested',
      detail: latestSource.source.title,
      badge: 'SOURCE',
      tone: 'emerald',
      at: latestSource.source.createdAt,
    });
  }

  const experiment = latestExperiment(experiments);
  if (experiment) {
    items.push({
      key: `experiment:${experiment.id}`,
      title: 'Experiment plan created',
      detail: `${experiment.claimTitle} · ${experiment.approvalState}`,
      badge: 'PLAN',
      tone: 'orange',
      at: experiment.createdAt,
    });
  }

  // The latest approval is found across every experiment: a newer pending plan
  // must not hide the decision that was actually recorded on an older one.
  let latestApproval: { id: string; claimTitle: string; at: string } | null = null;
  let latestApprovalAt: number | null = null;
  for (const candidate of experiments) {
    const at = timeValue(candidate.approvedAt);
    if (at === null) continue;
    if (latestApprovalAt === null || at >= latestApprovalAt) {
      latestApproval = {
        id: candidate.id,
        claimTitle: candidate.claimTitle,
        at: candidate.approvedAt!,
      };
      latestApprovalAt = at;
    }
  }
  if (latestApproval) {
    items.push({
      key: `approved:${latestApproval.id}`,
      title: 'Experiment plan approved',
      detail: latestApproval.claimTitle,
      badge: 'APPROVED',
      tone: 'emerald',
      at: latestApproval.at,
    });
  }

  let latestRun: { run: OverviewRunRow; claimTitle: string; at: number | null } | null = null;
  for (const candidate of experiments) {
    for (const run of candidate.runs) {
      const at = timeValue(run.finishedAt ?? run.createdAt);
      if (!latestRun || (at !== null && (latestRun.at === null || at >= latestRun.at))) {
        latestRun = { run, claimTitle: candidate.claimTitle, at };
      }
    }
  }
  if (latestRun) {
    const verdict = latestRun.run.verdict
      ? `verdict ${latestRun.run.verdict}`
      : 'verdict pending';
    items.push({
      key: `run:${latestRun.run.id}`,
      title: `Run ${latestRun.run.status}`,
      detail: `${latestRun.claimTitle} · ${verdict}`,
      badge: 'RUN',
      tone: latestRun.run.status === 'succeeded' ? 'emerald' : 'orange',
      at: latestRun.run.finishedAt ?? latestRun.run.createdAt ?? null,
    });
  }

  return items
    .map((item, index) => ({ item, index, at: timeValue(item.at) }))
    .sort((a, b) => {
      if (a.at === b.at) return a.index - b.index;
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return b.at - a.at;
    })
    .slice(0, 3)
    .map(({ item }) => item);
}
