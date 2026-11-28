/**
 * Pure input validation for the workspace source-ingestion route.
 *
 * Kept out of the route file so the SSRF and payload rules can be tested
 * without constructing a TanStack server handler. Nothing here performs I/O.
 */
import { isPdfUrl } from './firecrawl'
import { MAX_PDF_BYTES } from '../shared/source-limits'

// Defined in `shared/source-limits.ts` (3 MiB) so the browser label and this
// validator share one number; re-exported here because the sources route and
// its tests import the limit from this module.
export { MAX_PDF_BYTES }
export const MAX_SOURCE_URL_LENGTH = 2_048
export const MAX_SOURCE_TITLE_LENGTH = 300

/**
 * Expands an IPv6 literal (brackets already stripped) into its eight 16-bit
 * groups. An embedded dotted-quad tail such as `::ffff:127.0.0.1` is folded
 * into two hex groups first. Returns null when the literal is not IPv6.
 */
function parseIpv6Groups(literal: string): number[] | null {
  if (!literal.includes(':')) return null

  let text = literal
  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  const embeddedIpv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(tail)
  if (embeddedIpv4) {
    const octets = embeddedIpv4.slice(1).map(Number)
    if (octets.some((octet) => octet > 255)) return null
    const high = ((octets[0]! << 8) | octets[1]!).toString(16)
    const low = ((octets[2]! << 8) | octets[3]!).toString(16)
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null

  const readGroups = (part: string): number[] | null => {
    if (part === '') return []
    const groups: number[] = []
    for (const piece of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null
      groups.push(Number.parseInt(piece, 16))
    }
    return groups
  }

  const head = readGroups(halves[0] ?? '')
  if (!head) return null

  if (halves.length === 1) {
    return head.length === 8 ? head : null
  }

  const tailGroups = readGroups(halves[1] ?? '')
  if (!tailGroups) return null

  const missing = 8 - head.length - tailGroups.length
  if (missing < 1) return null
  return [...head, ...new Array<number>(missing).fill(0), ...tailGroups]
}

/**
 * Rejects URLs that could make a server-side scraper reach its own network.
 * Firecrawl performs the fetch, but forwarding `http://127.0.0.1` is still an
 * SSRF primitive worth closing at the application edge.
 */
export function validateIngestUrl(
  raw: string,
): { url: string } | { error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { error: 'url is required' }
  if (trimmed.length > MAX_SOURCE_URL_LENGTH) return { error: 'url is too long' }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { error: 'url must be an absolute http(s) URL' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'url must use http or https' }
  }
  if (parsed.username || parsed.password) {
    return { error: 'url must not contain credentials' }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  // Only literal addresses are inspected here. DNS names that resolve to
  // private space remain Firecrawl's responsibility.
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local')
  ) {
    return { error: 'url must not point at a local address' }
  }

  const ipv6Groups = parseIpv6Groups(hostname)
  if (ipv6Groups) {
    // Only global unicast (2000::/3) is reachable from here. Loopback,
    // ULA (fc00::/7), link-local (fe80::/10), unspecified (::), and
    // IPv4-embedded or NAT64 forms that wrap a private v4 address all fall
    // outside that range and are refused as literal addresses.
    const isGlobalUnicast = (ipv6Groups[0]! & 0xe000) === 0x2000
    if (!isGlobalUnicast) {
      return { error: 'url must not point at a private or reserved address' }
    }
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    const privateOrReserved =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    if (privateOrReserved) {
      return { error: 'url must not point at a private or reserved address' }
    }
  }

  if (isPdfUrl(trimmed)) {
    return {
      error: 'PDF URLs must be uploaded as a file so text extraction is coordinate-aware',
    }
  }

  return { url: trimmed }
}

/** Decodes a base64 PDF payload, enforcing the size ceiling. */
export function decodePdfBase64(value: string): Uint8Array | null {
  const payload = value.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
  if (!payload || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    return null
  }
  const buffer = Buffer.from(payload, 'base64')
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_BYTES) return null
  return new Uint8Array(buffer)
}
