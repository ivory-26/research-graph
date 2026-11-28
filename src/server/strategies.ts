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
 * averages exclude it rather than counting a zero. `input_ref.extractionRunLabel`
 * is display text rather than an id, so it is surfaced whenever the row carries
 * one — including `ui:<kind>` batches, which have a label but no run id.
 */
import type { AgentTaskStatus, TaskKind } from '../shared/types'
import type { AgentTaskRow } from '../shared/strategies'

const STRATEGY_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

export interface AgentTaskQueryRow {
  id: string
  taskKind: TaskKind
  /** Joined `agent_strategies.name`, preferred for display when present. */
  strategyName: string | null
  /** `agent_tasks.model`; the provider actually used for this attempt. */
  model?: string | null
  status: AgentTaskStatus
  inputRef: Record<string, unknown> | null
  latencyMs: number | null
  costUsd: string | number | null
  error: string | null
  /** `agent_tasks.created_at`; optional so older callers keep compiling. */
  createdAt?: Date | string | null
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
    // Older edge tasks may have stored a UUID in the strategy name field.
    const recordedStrategy = nonEmptyString(inputRef.strategy)
    const recordedName = recordedStrategy && !STRATEGY_UUID.test(recordedStrategy)
      ? recordedStrategy
      : null

    const rawCost = row.costUsd === null ? null : Number(row.costUsd)
    const costUsd =
      rawCost !== null && Number.isFinite(rawCost) ? rawCost : null
    const latencyMs =
      typeof row.latencyMs === 'number' && Number.isFinite(row.latencyMs)
        ? row.latencyMs
        : null
    const createdAt =
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : nonEmptyString(row.createdAt)

    return {
      id: row.id,
      taskKind: row.taskKind,
      strategyId: row.strategyName ?? recordedName ?? 'unassigned',
      runId: extractionRunId ?? experimentRunId,
      runLabel: extractionRunLabel,
      model: nonEmptyString(row.model),
      status: row.status,
      latencyMs,
      costUsd,
      error: row.error,
      createdAt,
    }
  })
}
