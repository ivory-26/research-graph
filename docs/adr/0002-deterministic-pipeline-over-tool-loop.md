# A deterministic pipeline, not a free tool-calling agent

The pipeline is a fixed sequence — ingest, extract, connect, plan, approve, execute, evaluate, branch — where each step is one structured-output model call and the code decides what runs next. The model never chooses the order.

A recorded demo gets one take. A tool-calling loop picks different tools in different orders on identical inputs, which makes the recording either heavily rehearsed or unreliable. It also drags in the AI SDK 7 tool-approval and streaming surface, which is the newest and least documented part of the stack.

## Consequences

- The "agent" vocabulary survives in the UI — strategies, tasks, a visible event log — but there is no autonomy to describe if a judge asks. The honest answer is "the model does the judgement at each step; the system decides which step is next."
- Adding a genuinely agentic step later means adding a new pipeline stage, not enabling a loop. That is the cheaper direction to move in.
- Retry and repair become explicit, bounded operations we control, which is what makes a demo reproducible.
