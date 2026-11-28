import { describe, expect, it } from 'vitest'

import { MAX_PDF_LABEL } from '../shared/source-limits'
import { decodePdfBase64, MAX_PDF_BYTES, validateIngestUrl } from './source-input'

describe('source ingestion input validation', () => {
  it('accepts ordinary public http(s) sources', () => {
    expect(validateIngestUrl('https://github.com/parrt/random-forest-importances')).toEqual({
      url: 'https://github.com/parrt/random-forest-importances',
    })
    expect(validateIngestUrl('http://example.com/paper')).toEqual({
      url: 'http://example.com/paper',
    })
  })

  it('rejects malformed, non-http and credential-bearing URLs', () => {
    expect(validateIngestUrl('')).toHaveProperty('error')
    expect(validateIngestUrl('not a url')).toHaveProperty('error')
    expect(validateIngestUrl('ftp://example.com/file')).toHaveProperty('error')
    expect(validateIngestUrl('https://user:pass@example.com/')).toHaveProperty('error')
  })

  it('rejects local, private and reserved hosts', () => {
    for (const url of [
      'http://localhost/admin',
      'http://app.localhost/',
      'http://printer.local/',
      'http://0.0.0.0/',
      'http://127.0.0.1/',
      'http://10.1.2.3/',
      'http://172.16.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.1/',
      'http://224.0.0.1/',
    ]) {
      expect(validateIngestUrl(url), url).toHaveProperty('error')
    }
  })

  it('rejects every non-global-unicast IPv6 literal', () => {
    for (const url of [
      'http://[::1]/',
      'http://[fc00::1]/',
      'http://[fd12::1]/',
      'http://[fe80::1]/',
      'http://[::]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:8.8.8.8]/',
      'http://[64:ff9b::7f00:1]/',
    ]) {
      expect(validateIngestUrl(url), url).toEqual({
        error: 'url must not point at a private or reserved address',
      })
    }
  })

  it('accepts public global-unicast IPv6 literals', () => {
    expect(validateIngestUrl('http://[2001:4860:4860::8888]/')).toEqual({
      url: 'http://[2001:4860:4860::8888]/',
    })
  })

  it('requires PDFs to be uploaded as files rather than scraped', () => {
    expect(validateIngestUrl('https://example.com/paper.pdf')).toHaveProperty('error')
    expect(validateIngestUrl('https://arxiv.org/pdf/2401.00001')).toHaveProperty('error')
  })

  it('decodes a valid base64 PDF payload and rejects malformed payloads', () => {
    const bytes = Buffer.from('%PDF-1.4\n test', 'utf8')
    const decoded = decodePdfBase64(bytes.toString('base64'))
    expect(decoded).not.toBeNull()
    expect(Buffer.from(decoded!).toString('utf8')).toBe('%PDF-1.4\n test')

    expect(decodePdfBase64('!!!not-base64!!!')).toBeNull()
    expect(decodePdfBase64('')).toBeNull()
  })

  it('caps PDFs at 3 MiB so the encoded body fits the platform request limit', () => {
    expect(MAX_PDF_BYTES).toBe(3 * 1024 * 1024)
    expect(MAX_PDF_LABEL).toBe('3 MB')

    const atLimit = Buffer.alloc(MAX_PDF_BYTES)
    expect(decodePdfBase64(atLimit.toString('base64'))).not.toBeNull()

    const overLimit = Buffer.alloc(MAX_PDF_BYTES + 1)
    expect(decodePdfBase64(overLimit.toString('base64'))).toBeNull()
  })
})
