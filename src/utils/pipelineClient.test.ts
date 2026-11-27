import { describe, it, expect, vi } from 'vitest';
import {
  sendPipelineApproval,
  subscribeToPipelineStream,
} from './pipelineClient';
import type { PipelineEvent } from '../shared/events';

describe('sendPipelineApproval', () => {
  it('validates input parameters before dispatching network request', async () => {
    const res1 = await sendPipelineApproval({
      experimentId: '',
      gateSeq: 1,
      decision: 'approved',
    });
    expect(res1.ok).toBe(false);
    expect(res1.error).toContain('experimentId is required');

    const res2 = await sendPipelineApproval({
      experimentId: 'exp-1',
      gateSeq: 0,
      decision: 'approved',
    });
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain('positive integer');

    const res3 = await sendPipelineApproval({
      experimentId: 'exp-1',
      gateSeq: 1,
      decision: 'invalid' as any,
    });
    expect(res3.ok).toBe(false);
    expect(res3.error).toContain('decision must be "approved" or "rejected"');
  });

  it('posts approval payload to /api/pipeline/:experimentId/approve successfully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({ status: 'approved', gateSeq: 2 }),
    });

    const result = await sendPipelineApproval(
      {
        experimentId: 'exp-hero-run-a',
        gateSeq: 2,
        decision: 'approved',
      },
      mockFetch as any,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ status: 'approved', gateSeq: 2 });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/pipeline/exp-hero-run-a/approve',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateSeq: 2, decision: 'approved' }),
      }),
    );
  });

  it('handles backend error responses gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({ error: 'User lacks workspace approval permissions' }),
    });

    const result = await sendPipelineApproval(
      {
        experimentId: 'exp-hero-run-a',
        gateSeq: 1,
        decision: 'rejected',
      },
      mockFetch as any,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toBe('User lacks workspace approval permissions');
  });

  it('handles network throw gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const result = await sendPipelineApproval(
      {
        experimentId: 'exp-hero-run-a',
        gateSeq: 1,
        decision: 'approved',
      },
      mockFetch as any,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBe('Connection refused');
  });
});

describe('subscribeToPipelineStream', () => {
  it('connects to the SSE endpoint and dispatches events and stdout logs', () => {
    let messageListener: ((e: any) => void) | null = null;
    let closed = false;

    class MockEventSource {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
      set onmessage(fn: any) {
        messageListener = fn;
      }
      close() {
        closed = true;
      }
    }

    const events: PipelineEvent[] = [];
    const logs: string[] = [];
    let approvalRequestedGateSeq: number | null = null;
    let completed = false;

    const cleanup = subscribeToPipelineStream(
      'exp-test-123',
      {
        onEvent: (e) => events.push(e),
        onLog: (l) => logs.push(l),
        onApprovalRequested: (e) => {
          approvalRequestedGateSeq = e.seq;
        },
        onComplete: () => {
          completed = true;
        },
      },
      {
        EventSourceClass: MockEventSource as any,
      },
    );

    expect(messageListener).toBeDefined();

    // 1. Stage started event
    messageListener!({
      data: JSON.stringify({
        seq: 1,
        experimentId: 'exp-test-123',
        at: new Date().toISOString(),
        type: 'stage.started',
        stage: 'PLAN_EXPERIMENT',
      }),
    });

    // 2. Approval requested event
    messageListener!({
      data: JSON.stringify({
        seq: 2,
        experimentId: 'exp-test-123',
        at: new Date().toISOString(),
        type: 'approval.requested',
        spec: { id: 'spec-1' },
      }),
    });

    // 3. Pipeline completed event
    messageListener!({
      data: JSON.stringify({
        seq: 3,
        experimentId: 'exp-test-123',
        at: new Date().toISOString(),
        type: 'pipeline.completed',
        runId: 'run-1',
      }),
    });

    expect(events.length).toBe(3);
    expect(logs).toContain('[STAGE] Started PLAN_EXPERIMENT (seq #1)');
    expect(logs).toContain('[APPROVAL] Gate seq #2 requested');
    expect(logs).toContain('[PIPELINE] Completed successfully (runId: run-1)');
    expect(approvalRequestedGateSeq).toBe(2);
    expect(completed).toBe(true);
    expect(closed).toBe(true);

    cleanup();
  });

  it('encodes initialLastSeq as ?seq=N and deduplicates events at or below lastSeq', () => {
    let messageListener: ((e: any) => void) | null = null;
    let capturedUrl = '';

    class MockEventSource {
      constructor(url: string) {
        capturedUrl = url;
      }
      set onmessage(fn: any) {
        messageListener = fn;
      }
      close() {}
    }

    const events: PipelineEvent[] = [];
    const cleanup = subscribeToPipelineStream(
      'exp-resume',
      { onEvent: (e) => events.push(e) },
      { EventSourceClass: MockEventSource as any, initialLastSeq: 4 },
    );

    expect(capturedUrl).toBe('/api/pipeline/exp-resume?seq=4');

    // Replayed event at seq <= 4 is skipped
    messageListener!({
      data: JSON.stringify({
        seq: 4,
        experimentId: 'exp-resume',
        at: new Date().toISOString(),
        type: 'stage.started',
        stage: 'PLAN_EXPERIMENT',
      }),
    });
    // Fresh event at seq 5 is delivered
    messageListener!({
      data: JSON.stringify({
        seq: 5,
        experimentId: 'exp-resume',
        at: new Date().toISOString(),
        type: 'stage.started',
        stage: 'EXECUTE',
      }),
    });
    // Duplicate seq 5 is skipped
    messageListener!({
      data: JSON.stringify({
        seq: 5,
        experimentId: 'exp-resume',
        at: new Date().toISOString(),
        type: 'stage.started',
        stage: 'EXECUTE',
      }),
    });

    expect(events.map((e) => e.seq)).toEqual([5]);
    cleanup();
  });
});
