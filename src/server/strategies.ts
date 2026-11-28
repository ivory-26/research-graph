/**
 * Pure projection from `agent_tasks` query rows to the dashboard contract.
 *
 * The route owns authentication and SQL; this module owns the one place where
 * `input_ref` is read so the precedence rules are testable without a database.
 *
 * Run attribution precedence:
 *   1. `input_ref.extractionRunId` — the stable id an extraction batch writes.
 *   2. `input_ref.runId` — the experiment run id older callers (and the repair
 *      loop) write. Kept as a fallback so existing task history is unchanged.
 *   3. `null` — a task recorded before either convention existed.
 *
 * A row is never given a synthetic run id. Missing telemetry stays `null` so
 * averages exclude it rather than counting a zero.
 */
import type { AgentTaskStatus, TaskKind } from '../shared/types'
import type { AgentTaskRow } from '../shared/strategies'

export interface AgentTaskQueryRow {
  id: string
  taskKind: TaskKind
  /** Joined `agent_strategies.name`, preferred for display when present. */
  strategyName: string | null
  strategyId: string | null
  status: AgentTaskStatus
  inputRef: Record<string, unknown> | null
  latencyMs: number | null
  costUsd: string | number | null
  error: string | null
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function mapAgentTaskQueryRows(rows: AgentTaskQueryRow[]): AgentTaskRow[] {
  return rows.map((row) => {
    const inputRef = row.inputRef ?? {}
    const extractionRunId = nonEmptyString(inputRef.extractionRunId)
    const experimentRunId = nonEmptyString(inputRef.runId)
    const extractionRunLabel = nonEmptyString(inputRef.extractionRunLabel)
    // The extractor records the human strategy name in `input_ref.strategy`
    // (`single_pass`, `sectioned`, ...). Use it before a raw strategy UUID so
    // the dashboard's strategy column names the strategy, not an unjoined id.
    const recordedStrategy = nonEmptyString(inputRef.strategy)

    const rawCost = row.costUsd === null ? null : Number(row.costUsd)
    const costUsd =
      rawCost !== null && Number.isFinite(rawCost) ? rawCost : null
    const latencyMs =
      typeof row.latencyMs === 'number' && Number.isFinite(row.latencyMs)
        ? row.latencyMs
        : null

    return {
      id: row.id,
      taskKind: row.taskKind,
      strategyId: row.strategyName ?? recordedStrategy ?? row.strategyId ?? 'unassigned',
      runId: extractionRunId ?? experimentRunId,
      runLabel: extractionRunId ? extractionRunLabel : null,
      status: row.status,
      latencyMs,
      costUsd,
      error: row.error,
    }
  })
}
