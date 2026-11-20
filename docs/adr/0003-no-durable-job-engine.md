# No durable workflow engine

Runs execute inside the HTTP request that started them. There is no Trigger.dev, Inngest or Restate account, and no separate worker process.

Every step in the pipeline is seconds long and the whole run has a hard 240-second budget. A durable engine buys retries across process death, long sleeps and approvals that outlive a request — none of which a demo with ten runs needs, and each of which costs an account, a CLI, a deploy target and a new mental model in the ten days available.

## Consequences

- A run that outlives its request is lost, and the user sees a failure rather than a resumable job. Accepted.
- The approval gate is synchronous: the user approves while the request is open. This is why the run budget must stay under Vercel Hobby's 300-second function ceiling.
- If a retry cascade does stretch past the ceiling, the escape hatch is moving only the streaming endpoint to Neon Functions (15-minute ceiling), not adopting a workflow engine. That swap is deliberately kept cheap by putting the runner behind one interface.
