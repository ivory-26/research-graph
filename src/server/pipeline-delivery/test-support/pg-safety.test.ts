/**
 * Safety net for the real-Postgres harness.
 *
 * These tests never open a connection: they pin the grammar and the target
 * checks that stand between a test run and someone's actual database.
 */
import { describe, expect, it } from 'vitest'
import {
  DISPOSABLE_DATABASE_PREFIX,
  assertDisposableAdminUrl,
  assertDisposableDatabaseName,
  createDisposableDatabaseName,
  createTestDatabase,
  withDatabaseName,
} from './pg'

const LOCAL = 'postgresql://postgres:postgres@127.0.0.1:55432/postgres'

describe('assertDisposableAdminUrl', () => {
  it.each([
    LOCAL,
    'postgresql://postgres:postgres@localhost:5432/maintenance',
    'postgres://postgres:postgres@[::1]:5432/postgres',
  ])('accepts a loopback endpoint: %s', (url) => {
    expect(assertDisposableAdminUrl(url, {}).hostname).not.toBe('')
  })

  it('refuses a remote host by default', () => {
    expect(() =>
      assertDisposableAdminUrl(
        'postgresql://user:secret@db.production.example:5432/app',
        {},
      ),
    ).toThrow(/not loopback/)
  })

  it('allows a remote host only with the explicit override', () => {
    expect(() =>
      assertDisposableAdminUrl(
        'postgresql://user:secret@db.example:5432/app',
        { TEST_DATABASE_ALLOW_REMOTE: '1' },
      ),
    ).not.toThrow()
  })

  it('does not treat a lookalike hostname as loopback', () => {
    expect(() =>
      assertDisposableAdminUrl(
        'postgresql://user:secret@localhost.evil.example:5432/app',
        {},
      ),
    ).toThrow(/not loopback/)
  })

  it.each([
    'mysql://user:secret@127.0.0.1:3306/app',
    'postgresql://127.0.0.1:5432',
    'host=127.0.0.1 dbname=app',
    'postgresql:///app',
  ])('refuses an unusable target: %s', (url) => {
    expect(() => assertDisposableAdminUrl(url, {})).toThrow(TypeError)
  })

  it('refuses to connect before it refuses to mutate', async () => {
    await expect(
      createTestDatabase(
        'postgresql://user:secret@db.production.example:5432/app',
        {},
      ),
    ).rejects.toThrow(/not loopback/)
  })
})

describe('disposable database names', () => {
  it('generates a unique name in the disposable namespace', () => {
    const first = createDisposableDatabaseName(1_700_000_000_000, 'a')
    const second = createDisposableDatabaseName(1_700_000_000_000, 'b')

    expect(first.startsWith(DISPOSABLE_DATABASE_PREFIX)).toBe(true)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^rg_test_[a-z0-9_]+$/)
    expect(() => assertDisposableDatabaseName(first)).not.toThrow()
  })

  it.each([
    'postgres',
    'public',
    'app_production',
    'rg_test_',
    'rg_test_UPPER',
    'rg_test_x; DROP DATABASE production',
    'rg_test_"quoted"',
  ])('refuses to operate on %s', (name) => {
    expect(() => assertDisposableDatabaseName(name)).toThrow(
      /only rg_test_\* names/,
    )
  })

  it('refuses a name that would exceed the identifier limit', () => {
    const tooLong = `${DISPOSABLE_DATABASE_PREFIX}${'a'.repeat(60)}`
    expect(() => assertDisposableDatabaseName(tooLong)).toThrow(
      /only rg_test_\* names/,
    )
  })

  it('points a URL at the generated database without touching other parts', () => {
    const name = createDisposableDatabaseName()
    const url = new URL(withDatabaseName(LOCAL, name))

    expect(url.pathname).toBe(`/${name}`)
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.port).toBe('55432')
    expect(url.username).toBe('postgres')
    expect(url.password).toBe('postgres')
  })

  it('refuses to rewrite a URL to a non-disposable database', () => {
    expect(() => withDatabaseName(LOCAL, 'production')).toThrow(
      /only rg_test_\* names/,
    )
  })
})
