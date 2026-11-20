# An edge cannot exist without evidence

Every edge row carries either a source-chunk locator or a run-artifact reference, enforced by a database check constraint. An edge proposed by the model without a resolvable quote is rejected before it is written.

The failure mode this prevents is the one that makes research graphs worthless: "Paper A supports Hypothesis B" with nothing behind it. A graph of ungrounded assertions looks identical to a graph of grounded ones, which means the ungrounded ones destroy the value of the grounded ones.

## Consequences

- The model must return a verbatim quote with every proposed edge, and the quote is validated against the chunk text. Extraction failures become visible as rejected edges rather than as silent fabrication.
- Some true relationships cannot be expressed, because they have no single quotable passage. Accepted — those belong in a note node with the researcher's own reasoning.
- Deleting a source cascades to its chunks and therefore to every edge that cited them. This is correct but destructive, so sources are immutable and deletions are soft.
