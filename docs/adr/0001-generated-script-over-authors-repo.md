# Generate an experiment script rather than running the authors' repository

The agent reads a paper's method and writes a minimal scikit-learn reimplementation, then runs that. The authors' repository is cited as evidence, never executed.

Every candidate paper's repository failed in a different way when checked on 2026-11-20: Boruta ships a notebook with no entrypoint, the SMOTE study's `requirements.txt` starts with `-e .` against a repo with no `setup.py`, CatBoost's official benchmark code is Python 2, and RTDL pins `numba==0.53.1` which declares `Requires-Python <3.10`. Running repositories would make the demo depend on four independent failure points.

## Consequences

- Every reproduction we produce is `adapted` mode, never `exact`. The interface must force a mode declaration so the demo cannot accidentally claim more than it did.
- The failure beat now comes from generated code — wrong column names, a missing import, a metric the script never wrote — rather than from dependency drift. This is weaker material than a real install failure, so the scripted anchor should be a genuine error observed during development.
- We give up the strongest possible pitch ("we ran their code"). The replacement pitch is narrower and more defensible: "we tested their claim, and we can show exactly how far our test is from their setup."
