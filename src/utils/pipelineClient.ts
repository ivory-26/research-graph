import type {
  PipelineEvent,
  ApprovalRequestedEvent,
  PipelineCompletedEvent,
  PipelineCancelledEvent,
  PipelineFailedEvent,
} from '../shared/events';
import { HEARTBEAT_INTERVAL_MS, STREAM_BUDGET_MS } from '../server/pipeline-transport/constants';

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
  /** The coded refusal from the server's `{ error: { code, message } }` envelope. */
  code?: string;
}

/**
 * Reads the delivery layer's error body. `src/server/pipeline-delivery/errors.ts`
 * answers every refusal with `{ error: { code, message } }`; older call sites
 * and transport failures used a bare `{ error: string }` or `{ message }`.
 * All three shapes are supported so the approval modal shows the server's
 * product-authored sentence instead of `HTTP 409: Conflict`.
 */
function readErrorBody(
  payload: unknown,
): { code?: string; message?: string } {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const error = record.error;

  if (typeof error === 'string' && error.trim().length > 0) {
    return { message: error };
  }

  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const envelope = error as Record<string, unknown>;
    return {
      code:
        typeof envelope.code === 'string' && envelope.code.trim().length > 0
          ? envelope.code
          : undefined,
      message:
        typeof envelope.message === 'string' &&
        envelope.message.trim().length > 0
          ? envelope.message
          : undefined,
    };
  }

  if (typeof record.message === 'string' && record.message.trim().length > 0) {
    return { message: record.message };
  }

  return {};
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
      const { code, message } = readErrorBody(data);
      const errorMsg = message ?? `HTTP ${response.status}: ${response.statusText}`;

      return {
        ok: false,
        status: response.status,
        data,
        error: errorMsg,
        code,
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
  onApprovalResolved?: () => void;
  onComplete?: (
    event: PipelineCompletedEvent | PipelineCancelledEvent | PipelineFailedEvent,
  ) => void;
}

/**
 * How long the client waits for new events before it stops the browser's
 * native `EventSource` from retrying forever.
 *
 * Native `EventSource` auto-reconnects on every error, including a permanent
 * 404/409 refusal, so a dead or finished run produces an endless retry loop:
 * each attempt opens a new request, gets the same refusal and fires `onerror`
 * again. The watchdog is one server budget plus one heartbeat of silence; a
 * reconnect that is actually replaying events re-arms it, while a refusal
 * loop never does.
 */
export const PIPELINE_STREAM_WATCHDOG_MS =
  STREAM_BUDGET_MS + HEARTBEAT_INTERVAL_MS;

export interface PipelineStreamOptions {
  EventSourceClass?: typeof EventSource;
  /**
   * Resume cursor: the seq of the last event seen in a previous connection.
   * When > 0 it is encoded as `?seq=N` in the stream URL so the server
   * replays only events after that cursor, matching the behaviour of the
   * native `Last-Event-ID` header sent on automatic reconnects.
   */
  initialLastSeq?: number;
  /**
   * Override for the no-progress watchdog. Tests inject a short value; the
   * default is `PIPELINE_STREAM_WATCHDOG_MS`. A non-positive value disables
   * the watchdog.
   */
  watchdogMs?: number;
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
  const startSeq = typeof options?.initialLastSeq === 'number' && options.initialLastSeq > 0
    ? options.initialLastSeq
    : 0;
  const url = startSeq > 0 ? `${baseUrl}?seq=${startSeq}` : baseUrl;
  const es = new ES(url);
  const watchdogMs = options?.watchdogMs ?? PIPELINE_STREAM_WATCHDOG_MS;
  let lastSeq = startSeq;
  let closed = false;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = (): void => {
    if (watchdogTimer !== null) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    clearWatchdog();
    es.close();
  };

  /**
   * (Re)starts the no-progress deadline. It is re-armed only by a newly
   * delivered event: replay duplicates do not count as progress, and an
   * erroring connection never does, so a permanent refusal cannot keep the
   * native reconnect loop alive forever.
   */
  const armWatchdog = (): void => {
    if (closed || watchdogMs <= 0) return;
    clearWatchdog();
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      if (closed) return;
      close();
      handlers.onError?.(
        new Error(
          `Pipeline stream received no events for ${watchdogMs} ms; stopped reconnecting`,
        ),
      );
    }, watchdogMs);
  };

  armWatchdog();

  es.onmessage = (e: MessageEvent) => {
    if (closed) return;
    try {
      const data = JSON.parse(e.data) as PipelineEvent;
      if (typeof data.seq === 'number' && data.seq <= lastSeq) {
        return;
      }
      if (typeof data.seq === 'number') {
        lastSeq = data.seq;
      }
      armWatchdog();
      handlers.onEvent?.(data);

      if (data.type === 'stage.started') {
        handlers.onLog?.(`[STAGE] Started ${data.stage} (seq #${data.seq})`);
      } else if (data.type === 'stage.finished') {
        handlers.onLog?.(`[STAGE] Finished ${data.stage}: ${data.status}`);
      } else if (data.type === 'approval.requested') {
        handlers.onLog?.(`[APPROVAL] Gate seq #${data.seq} requested`);
        handlers.onApprovalRequested?.(data);
      } else if (data.type === 'approval.resolved') {
        handlers.onLog?.(`[APPROVAL] Gate seq #${data.seq} resolved as ${data.state.toUpperCase()}`);
        handlers.onApprovalResolved?.();
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
        try {
          handlers.onComplete?.(data);
        } finally {
          // A terminal event is the only clean end: stop the watchdog and
          // the native connection together.
          close();
        }
      }
    } catch (parseErr) {
      handlers.onError?.(parseErr);
    }
  };

  es.onerror = (err) => {
    if (closed) return;
    handlers.onError?.(err);
  };

  return () => {
    close();
  };
}
