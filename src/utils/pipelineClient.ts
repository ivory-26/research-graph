import type {
  PipelineEvent,
  ApprovalRequestedEvent,
  PipelineCompletedEvent,
  PipelineCancelledEvent,
  PipelineFailedEvent,
} from '../shared/events';

export type ApprovalDecision = 'approved' | 'rejected';

export interface SendApprovalParams {
  experimentId: string;
  gateSeq: number;
  decision: ApprovalDecision;
}

export interface SendApprovalResult {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

/**
 * Dispatches human-in-the-loop approval decision to the backend pipeline approval endpoint:
 * POST /api/pipeline/:experimentId/approve
 */
export async function sendPipelineApproval(
  params: SendApprovalParams,
  fetchImpl: typeof fetch = fetch,
): Promise<SendApprovalResult> {
  const { experimentId, gateSeq, decision } = params;

  if (!experimentId) {
    return {
      ok: false,
      status: 400,
      error: 'experimentId is required',
    };
  }

  if (!Number.isSafeInteger(gateSeq) || gateSeq <= 0) {
    return {
      ok: false,
      status: 400,
      error: 'gateSeq must be a positive integer',
    };
  }

  if (decision !== 'approved' && decision !== 'rejected') {
    return {
      ok: false,
      status: 400,
      error: 'decision must be "approved" or "rejected"',
    };
  }

  try {
    const url = `/api/pipeline/${encodeURIComponent(experimentId)}/approve`;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gateSeq, decision }),
    });

    let data: any = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    }

    if (!response.ok) {
      const errorMsg =
        (data && typeof data === 'object' && typeof data.error === 'string' && data.error) ||
        (data && typeof data === 'object' && typeof data.message === 'string' && data.message) ||
        `HTTP ${response.status}: ${response.statusText}`;

      return {
        ok: false,
        status: response.status,
        data,
        error: errorMsg,
      };
    }

    return {
      ok: true,
      status: response.status,
      data,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface PipelineStreamHandlers {
  onEvent?: (event: PipelineEvent) => void;
  onLog?: (line: string) => void;
  onError?: (error: unknown) => void;
  onApprovalRequested?: (event: ApprovalRequestedEvent) => void;
  onComplete?: (
    event: PipelineCompletedEvent | PipelineCancelledEvent | PipelineFailedEvent,
  ) => void;
}

export interface PipelineStreamOptions {
  EventSourceClass?: typeof EventSource;
  lastEventId?: string;
}

/**
 * Subscribes to the live Server-Sent Events (SSE) stream for an experiment:
 * GET /api/pipeline/:experimentId
 *
 * Returns a cleanup function that closes the connection.
 */
export function subscribeToPipelineStream(
  experimentId: string,
  handlers: PipelineStreamHandlers,
  options?: PipelineStreamOptions,
): () => void {
  const ES = options?.EventSourceClass ?? (typeof EventSource !== 'undefined' ? EventSource : null);

  if (!ES) {
    handlers.onError?.(new Error('EventSource is not supported in this environment'));
    return () => {};
  }

  const baseUrl = `/api/pipeline/${encodeURIComponent(experimentId)}`;
  const url = options?.lastEventId
    ? `${baseUrl}?lastEventId=${encodeURIComponent(options.lastEventId)}`
    : baseUrl;
  const es = new ES(url);

  es.onmessage = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as PipelineEvent;
      handlers.onEvent?.(data);

      if (data.type === 'run.stdout') {
        handlers.onLog?.(data.chunk);
      } else if (data.type === 'stage.started') {
        handlers.onLog?.(`[STAGE] Started ${data.stage} (seq #${data.seq})`);
      } else if (data.type === 'stage.finished') {
        handlers.onLog?.(`[STAGE] Finished ${data.stage}: ${data.status}`);
      } else if (data.type === 'approval.requested') {
        handlers.onLog?.(`[APPROVAL] Gate seq #${data.seq} requested`);
        handlers.onApprovalRequested?.(data);
      } else if (data.type === 'approval.resolved') {
        handlers.onLog?.(`[APPROVAL] Gate seq #${data.seq} resolved as ${data.state.toUpperCase()}`);
      } else if (
        data.type === 'pipeline.completed' ||
        data.type === 'pipeline.cancelled' ||
        data.type === 'pipeline.failed'
      ) {
        if (data.type === 'pipeline.cancelled') {
          handlers.onLog?.(`[PIPELINE] Cancelled: ${data.reason}`);
        } else if (data.type === 'pipeline.failed') {
          handlers.onLog?.(`[PIPELINE] Failed: ${data.error}`);
        } else {
          handlers.onLog?.(`[PIPELINE] Completed successfully (runId: ${data.runId ?? 'n/a'})`);
        }
        handlers.onComplete?.(data);
        es.close();
      }
    } catch (parseErr) {
      handlers.onError?.(parseErr);
    }
  };

  es.onerror = (err) => {
    handlers.onError?.(err);
  };

  return () => {
    es.close();
  };
}
