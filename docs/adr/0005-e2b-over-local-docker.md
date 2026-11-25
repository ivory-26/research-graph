# E2B runs experiments; Docker is a story, not a path

Generated Python executes in an E2B sandbox. The local Docker path ships as a Dockerfile plus a documented `docker run --network none` command, and is never on the demo's critical path.

The people judging this will be watching a recording or opening a link, on a machine with no Docker daemon running — including the developer's own machine, where Docker Desktop is installed but stopped. E2B's base image already contains numpy, pandas, scikit-learn and matplotlib, its TypeScript SDK is official, it streams stdout incrementally, and the $100 startup credit with no card requirement covers far more than this project can use.

## Consequences

- The "runs on a laptop CPU" requirement is satisfied by a documented command, not by a demonstrated one. That is a weaker claim, and the video should not imply otherwise.
- Dataset downloads happen in the application, not the sandbox, so execution can run with networking disabled. The sandbox only ever sees bytes we already hashed.
- We depend on a third party for the single most important step in the demo. Mitigation is a pre-warmed sandbox and a pre-recorded video, not a second cloud provider.

## Update — 25 November 2026

The Docker path is now demonstrated, not just documented. `Dockerfile.template` builds the pinned image, and `pnpm verify:hero` runs it with the hardening flags, checks the dataset hash, validates `metrics.json` through `evaluateExperiment`, and compares the output with `HERO_RECORDED_RUN_RESULT`. The E2B path also completed a real hero run on 25 November. The video may say the experiment was verified on a laptop CPU; it should not imply the recording used Docker.
