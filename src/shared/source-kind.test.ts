import { describe, expect, it } from 'vitest'

import { inferSourceKind } from './source-kind'

describe('inferSourceKind', () => {
  it('treats the supported code hosts as repositories', () => {
    for (const url of [
      'https://github.com/parrt/random-forest-importances',
      'https://www.github.com/parrt/random-forest-importances',
      'https://gitlab.com/group/project',
      'https://bitbucket.org/team/repo',
      'https://codeberg.org/user/repo',
      '  https://GITHUB.com/parrt/random-forest-importances  ',
    ]) {
      expect(inferSourceKind(url), url).toBe('repo')
    }
  })

  it('treats paths ending in .git as repositories even on another host', () => {
    expect(inferSourceKind('https://example.com/lab/project.git')).toBe('repo')
    expect(inferSourceKind('https://example.com/lab/project.git/')).toBe('repo')
    expect(inferSourceKind('example.com/lab/project.git')).toBe('repo')
  })

  it('treats everything else as a web page, including repository-like subpaths', () => {
    for (const url of [
      'https://example.com/paper',
      'https://arxiv.org/abs/2401.00001',
      'https://github.io/parrt/random-forest-importances',
      'https://raw.githubusercontent.com/parrt/repo/main/README.md',
      '',
    ]) {
      expect(inferSourceKind(url), url).toBe('web')
    }
  })
})
