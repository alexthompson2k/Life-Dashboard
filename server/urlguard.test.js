import { describe, expect, it, vi } from 'vitest'

/**
 * This is the security boundary for user-supplied calendar URLs, so the
 * blocked cases matter more than the allowed ones. DNS is mocked so the tests
 * are hermetic and can exercise the rebinding case.
 */

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))

vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))

const { assertPublicUrl, isBlockedAddress, BlockedUrlError } = await import('./urlguard.js')

const resolvesTo = (...addresses) =>
  mocks.lookup.mockResolvedValue(addresses.map((address) => ({ address, family: 4 })))

describe('isBlockedAddress', () => {
  it('blocks loopback', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true)
    expect(isBlockedAddress('::1')).toBe(true)
  })

  it('blocks the cloud metadata endpoint', () => {
    // The classic SSRF target: instance credentials live here.
    expect(isBlockedAddress('169.254.169.254')).toBe(true)
  })

  it('blocks RFC1918 private ranges', () => {
    expect(isBlockedAddress('10.0.0.5')).toBe(true)
    expect(isBlockedAddress('172.16.0.1')).toBe(true)
    expect(isBlockedAddress('172.31.255.254')).toBe(true)
    expect(isBlockedAddress('192.168.1.1')).toBe(true)
  })

  it('allows public addresses either side of the private ranges', () => {
    expect(isBlockedAddress('172.15.0.1')).toBe(false)
    expect(isBlockedAddress('172.32.0.1')).toBe(false)
    expect(isBlockedAddress('8.8.8.8')).toBe(false)
    expect(isBlockedAddress('1.1.1.1')).toBe(false)
  })

  it('blocks carrier-grade NAT and multicast', () => {
    expect(isBlockedAddress('100.64.0.1')).toBe(true)
    expect(isBlockedAddress('224.0.0.1')).toBe(true)
  })

  it('blocks IPv6 private and link-local ranges', () => {
    expect(isBlockedAddress('fe80::1')).toBe(true)
    expect(isBlockedAddress('fd00::1')).toBe(true)
    expect(isBlockedAddress('2606:4700::1111')).toBe(false)
  })

  it('sees through IPv4-mapped IPv6 addresses', () => {
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false)
  })

  it('refuses anything unparseable rather than assuming it is safe', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true)
    expect(isBlockedAddress('')).toBe(true)
  })
})

describe('assertPublicUrl', () => {
  it('accepts a public https URL', async () => {
    resolvesTo('8.8.8.8')
    const url = await assertPublicUrl('https://calendar.example.com/feed.ics')
    expect(url.hostname).toBe('calendar.example.com')
  })

  it('rejects non-http schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(BlockedUrlError)
    await expect(assertPublicUrl('ftp://example.com/x')).rejects.toThrow(BlockedUrlError)
  })

  it('rejects a malformed URL', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toThrow(BlockedUrlError)
  })

  it('rejects a literal private IP without touching DNS', async () => {
    mocks.lookup.mockReset()
    await expect(assertPublicUrl('http://127.0.0.1:8787/api/health')).rejects.toThrow(
      BlockedUrlError,
    )
    expect(mocks.lookup).not.toHaveBeenCalled()
  })

  it('rejects a public hostname that resolves to a private address', async () => {
    // The whole reason the check happens after resolution.
    resolvesTo('10.0.0.5')
    await expect(assertPublicUrl('https://evil.example.com/feed.ics')).rejects.toThrow(
      BlockedUrlError,
    )
  })

  it('rejects when any resolved address is private', async () => {
    // One private answer among public ones is enough for DNS rebinding.
    resolvesTo('8.8.8.8', '192.168.0.10')
    await expect(assertPublicUrl('https://mixed.example.com/feed.ics')).rejects.toThrow(
      BlockedUrlError,
    )
  })

  it('rejects a hostname that will not resolve', async () => {
    mocks.lookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertPublicUrl('https://nope.example.com')).rejects.toThrow(
      BlockedUrlError,
    )
  })

  it('rejects a hostname resolving to nothing', async () => {
    mocks.lookup.mockResolvedValue([])
    await expect(assertPublicUrl('https://empty.example.com')).rejects.toThrow(
      BlockedUrlError,
    )
  })
})
