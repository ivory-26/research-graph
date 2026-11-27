import { describe, expect, it, vi } from 'vitest';
import { createPipelineHandlers } from './handlers';
import type { PipelineData } from './data';
import type { ExecutionClaimView } from '../../db/pipeline-types';

const EXP_ID = '11111111-1111-4111-8111-111111111111';
const WS_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'user-1';

const MOCK_CLAIM: ExecutionClaimView = {
  id: 'existing-claim',
  experimentId: EXP_ID,
  workspaceId: WS_ID,
  claimedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  closedAt: null,
  closeReason: null,
  active: true,
  expired: false,
};

function makeMockData(): {
  data: PipelineData;
  listCalls: Array<{ afterSeq: number }>;
  claimCalls: number;
} {
  const listCalls: Array<{ afterSeq: number }> = [];
  let claimCalls = 0;

  const data: PipelineData = {
    findExperiment: async () => ({
      id: EXP_ID,
      workspaceId: WS_ID,
      claimNodeId: '33333333-3333-4333-8333-333333333333',
      mode: 'adapted',
      approvalState: 'pending',
    }),
    findWorkspaceMember: async () => ({
      workspaceId: WS_ID,
      userId: USER_ID,
      role: 'owner',
    }),
    getExecutionClaim: async () => MOCK_CLAIM,
    claimExecutionStart: async () => {
      claimCalls += 1;
      return { outcome: 'claimed', claim: MOCK_CLAIM };
    },
    replayPipelineEvents: async (input) => {
      const afterSeq = input.afterSeq ?? 0;
      listCalls.push({ afterSeq });
      return {
        headSeq: afterSeq + 1,
        hasMore: false,
        events: [
          {
            seq: afterSeq + 1,
            experimentId: EXP_ID,
            at: new Date().toISOString(),
            type: 'stage.started',
            stage: 'PLAN_EXPERIMENT',
          },
        ],
      };
    },
    appendPipelineEvent: async () => {
      throw new Error('not expected');
    },
    openApprovalGate: async () => {
      throw new Error('not expected');
    },
    getApprovalGate: async () => null,
    decideApproval: async () => {
      throw new Error('not expected');
    },
    getExperimentApprovalState: async () => null,
  };

  return {
    data,
    listCalls,
    get claimCalls() {
      return claimCalls;
    },
  };
}

describe('pipeline stream ?seq=N fallback', () => {
  it('uses ?seq=N when Last-Event-ID header is absent and allows claiming if no claim exists', async () => {
    const mock = makeMockData();
    mock.data.getExecutionClaim = async () => null;
    const handlers = createPipelineHandlers({
      data: mock.data,
      readActor: async () => ({ id: USER_ID }),
      stages: {
        plan: vi.fn(),
        execute: vi.fn(),
        evaluate: vi.fn(),
      } as any,
    });

    const req = new Request(`http://localhost/api/pipeline/${EXP_ID}?seq=4`, {
      method: 'GET',
      headers: { origin: 'http://localhost' },
    });
    const res = await handlers.stream(req, { experimentId: EXP_ID });

    expect(res.status).toBe(200);
    expect(mock.listCalls[0]?.afterSeq).toBe(4);
    expect(mock.claimCalls).toBe(1);
    await res.body?.cancel();
  });

  it('prefers Last-Event-ID header over ?seq=N and skips claiming', async () => {
    const mock = makeMockData();
    mock.data.getExecutionClaim = async () => null;
    const handlers = createPipelineHandlers({
      data: mock.data,
      readActor: async () => ({ id: USER_ID }),
      stages: null,
    });

    const req = new Request(`http://localhost/api/pipeline/${EXP_ID}?seq=2`, {
      method: 'GET',
      headers: {
        origin: 'http://localhost',
        'last-event-id': '7',
      },
    });
    const res = await handlers.stream(req, { experimentId: EXP_ID });

    expect(res.status).toBe(200);
    expect(mock.listCalls[0]?.afterSeq).toBe(7);
    expect(mock.claimCalls).toBe(0);
    await res.body?.cancel();
  });

  it('returns 400 INVALID_LAST_EVENT_ID for non-integer ?seq', async () => {
    const mock = makeMockData();
    const handlers = createPipelineHandlers({
      data: mock.data,
      readActor: async () => ({ id: USER_ID }),
      stages: null,
    });

    const req = new Request(`http://localhost/api/pipeline/${EXP_ID}?seq=abc`, {
      method: 'GET',
      headers: { origin: 'http://localhost' },
    });
    const res = await handlers.stream(req, { experimentId: EXP_ID });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('INVALID_LAST_EVENT_ID');
  });
});
