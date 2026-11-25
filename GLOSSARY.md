# ResearchGraph

A workspace where a researcher turns a paper into a connected, executable and auditable claim: what it asserts, what evidence supports it, what happened when we ran it, and what changes when a parameter changes.

## Language

### Sources and evidence

**Source**:
An ingested artifact — a paper PDF, a project web page, a repository README, or a dataset landing page. A source is immutable once ingested.
_Avoid_: Document, file, attachment

**Chunk**:
A passage of a source, stored with its page and character span, and embedded for retrieval. Chunks are what citations point at.
_Avoid_: Segment, split, fragment

**Locator**:
The exact place in a source a claim or edge was drawn from — page number plus a verbatim quote. A locator that does not match the source text is a bug, not a formatting choice.
_Avoid_: Reference, pointer, citation

### The graph

**Node**:
A typed element of the workspace graph. Node types are `claim`, `method`, `dataset`, `result`, `run`, `note` and `source`.
_Avoid_: Card, item, entry

**Edge**:
A typed relationship between two nodes, carrying the evidence that justifies it. An edge with no evidence cannot be created.
_Avoid_: Link, connection, relation

**Evidence**:
The locator or run artifact that justifies an edge. Evidence is what makes an edge auditable rather than asserted.
_Avoid_: Proof, support, backing

**Claim**:
A testable assertion extracted from a source, with its method, dataset and reported result. A claim is the unit everything else hangs off.
_Avoid_: Hypothesis, finding, statement

### Reproduction

**Reported value**:
The number a paper claims, exactly as published. Never overwritten.
_Avoid_: Expected, ground truth, target

**Measured value**:
The number our run actually produced. Stored separately from the reported value, always.
_Avoid_: Actual, observed, result

**Mode**:
How faithful a run is to the original: `exact` (same code, data, environment), `adapted` (documented changes, e.g. reduced compute) or `conceptual` (the idea reimplemented on a toy setup). Every run declares one.
_Avoid_: Fidelity, match type, reproduction level

**Verdict**:
The outcome of comparing measured against reported: `match`, `mismatch`, `inconclusive` or `failed`. A verdict about an adapted run says nothing about exact reproducibility.
_Avoid_: Result, outcome, score

**Run**:
One execution of one experiment specification, with its own environment, seed, metrics, logs and artifacts.
_Avoid_: Execution, job, attempt

**Lineage**:
The parent chain of runs. A what-if run descends from the run it modified; the ancestor is never overwritten.
_Avoid_: History, versioning, ancestry

**What-if**:
A child experiment derived from a parent by changing exactly one parameter, run and compared against its parent.
_Avoid_: Variant, tweak, experiment branch

### Agents

**Strategy**:
A named configuration for one pipeline task — for example an extraction strategy that reads a paper in one pass versus section by section. Strategies are selected, not trained.
_Avoid_: Agent, prompt, model

**Task**:
One recorded execution of a strategy: its inputs, output, cost, latency and status.
_Avoid_: Step, call, invocation

**Pipeline**:
The fixed sequence of tasks from ingestion to verdict. The model fills in each task; the code decides the order.
_Avoid_: Agent loop, workflow, orchestration

**Stage**:
One of the eight fixed steps in the pipeline. A deterministic stage has no model call and therefore no task.
_Avoid_: Phase, step, node

### Pipeline delivery

**Execution claim**:
The single permission to start a pipeline run for one experiment. It is not a run and not a status; it is closed by a terminal event.
_Avoid_: Lock, lease, job token

**Gate**:
The human approval point for one execution claim, bound to the exact plan that was offered. A decision names its gate, so it cannot approve a different plan.
_Avoid_: Checkpoint, review step, sign-off

**Event**:
One persisted, sequenced fact about a pipeline run: `stage.started`, `approval.requested`, `verdict.computed`. Events replay from a cursor; they are not free-text log lines.
_Avoid_: Log, message, notification

**Fixture**:
Recorded demo data the UI renders before it is wired to the database. A fixture is not seed data and never stands in for a measured value.
_Avoid_: Mock, sample data, seed
