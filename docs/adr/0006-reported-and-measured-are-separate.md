# Reported and measured values never share a field

A claim node stores the number the paper published. A result node stores the number our run produced. They are different rows with different types and no code path copies one into the other.

Almost every reproducibility failure we researched is a version of this mistake — an author's number and a system's number being treated as the same quantity, so a 0.94 becomes "reproduced" because nobody recorded which 0.94 it was. Making the distinction structural means the UI cannot accidentally present a measurement as a citation, or a citation as a measurement.

## Consequences

- Every comparison is a join, never a column read. Slightly more query code, permanently fewer lies.
- A claim with no reported value is legal (the Strobl paper's claim is qualitative), so the comparison must handle a predicate verdict as well as a numeric tolerance.
- The verdict is computed from the pair; it is never stored on the claim.
