import { describe, expect, it } from 'vitest'

import { mapAgentTaskQueryRows, type AgentTaskQueryRow } from './strategies'

function row(overrides: Partial<AgentTaskQueryRow> = {}): AgentTaskQueryRow {
  return {
    id: 'task-1',
    taskKind: 'extract_claims',
    strategyName: 'single_pass',
    status: 'succeeded',
    inputRef: {},
    latencyMs: 1200,
    costUsd: '0.004000',
    error: null,
    ...overrides,
  }
}

describe('mapAgentTaskQueryRows', () => {
  it('prefers the stable extraction run id and carries its label', () => {
    const [task] = mapAgentTaskQueryRows([
      row({
        inputRef: {
          extractionRunId: 'extract:strobl-2007:single_pass',
          extractionRunLabel: 'Strobl 2007 · single_pass',
          runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      }),
    ])

    expect(task!.runId).toBe('extract:strobl-2007:single_pass')
    expect(task!.runLabel).toBe('Strobl 2007 · single_pass')
  })

  it('falls back to an experiment runId for older attributed tasks', () => {
    const [task] = mapAgentTaskQueryRows([
      row({
        taskKind: 'repair_script',
        inputRef: { experimentId: 'exp-1', runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      }),
    ])

    expect(task!.runId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(task!.runLabel).toBeNull()
  })

  it('keeps pre-attribution rows unattributed rather than inventing an id', () => {
    const [task] = mapAgentTaskQueryRows([row({ inputRef: { sourceId: 's-1' } })])
    expect(task!.runId).toBeNull()
    expect(task!.runLabel).toBeNull()
  })

  it('treats blank or non-string run fields as absent', () => {
    const [task] = mapAgentTaskQueryRows([
      row({ inputRef: { extractionRunId: '   ', extractionRunLabel: 42, runId: '' } }),
    ])
    expect(task!.runId).toBeNull()
    expect(task!.runLabel).toBeNull()
  })

  it('normalizes cost and latency without substituting zero', () => {
    const [missing] = mapAgentTaskQueryRows([
      row({ costUsd: null, latencyMs: null }),
    ])
    expect(missing!.costUsd).toBeNull()
    expect(missing!.latencyMs).toBeNull()

    const [measured] = mapAgentTaskQueryRows([
      row({ costUsd: '0.001500', latencyMs: 250 }),
    ])
    expect(measured!.costUsd).toBeCloseTo(0.0015)
    expect(measured!.latencyMs).toBe(250)
  })

  it('uses strategy names and leaves tasks without a name unassigned', () => {
    const tasks = mapAgentTaskQueryRows([
      row({ strategyName: 'sectioned', inputRef: { strategy: 'single_pass' } }),
      row({
        id: 'task-2',
        strategyName: null,
        inputRef: { strategy: 'single_pass' },
      }),
      row({
        id: 'task-3',
        taskKind: 'propose_edges',
        strategyName: null,
        inputRef: { strategy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      }),
      row({ id: 'task-4', strategyName: null }),
    ])

    expect(tasks.map((task) => task.strategyId)).toEqual([
      'sectioned',
      'single_pass',
      'unassigned',
      'unassigned',
    ])
  })
})
