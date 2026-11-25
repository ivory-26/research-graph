#!/usr/bin/env node

/**
 * Publish the pinned `researchgraph-python:locked` E2B template from
 * `Dockerfile.template`.
 *
 * The CLI's `template create` rejects a colon in the name, but the Template
 * SDK accepts `name:tag`, which is what `E2BRunner` and the planner expect.
 * Requires `E2B_API_KEY` in the environment and a running Docker daemon.
 *
 * Rebuilds are cached; run only after changing `Dockerfile.template`.
 */
import { Template, defaultBuildLogger } from 'e2b'

const template = Template().fromDockerfile('Dockerfile.template')
const info = await Template.build(template, 'researchgraph-python:locked', {
  cpuCount: 1,
  memoryMB: 2048,
  onBuildLogs: defaultBuildLogger({ minLevel: 'info' }),
})
console.log('BUILD_INFO ' + JSON.stringify(info))
