# Postgres holds the graph; there is no graph database

Nodes and edges are two tables in Neon Postgres, traversed with recursive CTEs. The workspace graph is hundreds of nodes, not millions.

Neo4j or a similar store would add a second database, a second connection, a second migration story and a query language nobody on the team has used, to answer traversal questions that a recursive CTE answers in a few milliseconds at this scale. Neon also gives us pgvector in the same transaction as the graph writes, which matters because embeddings and edges are written together.

## Consequences

- Graph-shaped queries are written by hand rather than expressed in Cypher. Depth-limited traversal must be bounded explicitly or a cyclic edge can hang a query.
- If the graph ever grows past tens of thousands of nodes the recursive CTEs become the bottleneck. Nothing here prevents adding a real graph store later, because the graph is only ever read through a small set of query functions.
