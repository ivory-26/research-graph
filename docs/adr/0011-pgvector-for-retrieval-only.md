# pgvector serves cross-source retrieval and nothing else

Chunks are embedded at 768 dimensions and queried only by the "ask across sources" feature and by the retrieval step that feeds claim extraction. Vector similarity is not used to propose graph edges.

Edge proposal by embedding similarity was considered and rejected: two passages can be numerically close and semantically opposed, and the resulting suggestions are the least convincing thing on a research canvas. Edges are proposed by the model with explicit relations and validated evidence, which is slower and better.

## Consequences

- The embedding pipeline has one consumer, so it can stay simple: chunk, embed, store, top-k search with a source filter.
- HNSW indexing on a workspace with a few hundred chunks is unnecessary; a sequential scan is faster than the index overhead at this size. Add the index only if a performance problem appears.
- Similarity thresholds are a product decision, not a retrieval decision, and belong in one constant rather than scattered through queries.
