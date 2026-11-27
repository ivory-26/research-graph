/**
 * Python source that makes `spec.parameters` available to a verbatim
 * experiment script outside the E2B runner.
 *
 * The production runner sets `RESEARCHGRAPH_PARAMETERS` to the frozen
 * parameters as a JSON string on the process environment. A notebook executed
 * on its own has no such variable, and the pinned hero script reads it on one
 * of its first lines, so the notebook must set it before the script cell.
 * Both notebook builders (`src/server/notebook.ts` and `ExportModal`) use this
 * function so the two cannot drift.
 */
export function buildParameterEnvironmentSource(
  parameters: Readonly<Record<string, unknown>>,
): string {
  const json = JSON.stringify(parameters)
  return [
    'import os',
    '# The production runner sets this variable; a notebook must set it itself.',
    `os.environ["RESEARCHGRAPH_PARAMETERS"] = ${JSON.stringify(json)}`,
  ].join('\n')
}
