import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The auth middleware is the only thing standing between one signed-in user
 * and another's rows, so its rejection paths are worth pinning down. Supabase
 * is mocked here because the point is the gate, not the token format.
 */

const mocks = vi.hoisted(() => ({
  supabaseConfigured: true,
  userIdFromToken: vi.fn(),
}))

vi.mock('./supabase.js', () => ({
  get supabaseConfigured() {
    return mocks.supabaseConfigured
  },
  userIdFromToken: mocks.userIdFromToken,
}))

const { requireUser } = await import('./auth.js')

function mockRes() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.payload = body
      return this
    },
  }
}

const mockReq = (authorization) => ({
  get: (name) => (name.toLowerCase() === 'authorization' ? authorization : undefined),
})

beforeEach(() => {
  mocks.supabaseConfigured = true
  mocks.userIdFromToken.mockReset()
})

describe('requireUser', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = mockRes()
    const next = vi.fn()

    await requireUser(mockReq(undefined), res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a header that is not a bearer token', async () => {
    const res = mockRes()
    const next = vi.fn()

    await requireUser(mockReq('Basic abc123'), res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a token Supabase does not recognise', async () => {
    mocks.userIdFromToken.mockResolvedValue(null)
    const res = mockRes()
    const next = vi.fn()

    await requireUser(mockReq('Bearer expired-token'), res, next)

    expect(res.statusCode).toBe(401)
    expect(res.payload.error).toMatch(/invalid or expired/i)
    expect(next).not.toHaveBeenCalled()
  })

  it('passes the resolved user id through on a valid token', async () => {
    mocks.userIdFromToken.mockResolvedValue('user-123')
    const req = mockReq('Bearer good-token')
    const res = mockRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.userId).toBe('user-123')
    expect(res.statusCode).toBeNull()
  })

  it('never trusts a user id supplied by the caller', async () => {
    mocks.userIdFromToken.mockResolvedValue('real-user')
    // A request body claiming to be someone else must not win.
    const req = { ...mockReq('Bearer good-token'), userId: 'attacker-supplied', body: { user_id: 'victim' } }
    const res = mockRes()

    await requireUser(req, res, vi.fn())

    expect(req.userId).toBe('real-user')
  })

  it('explains itself when Supabase is not configured', async () => {
    mocks.supabaseConfigured = false
    const res = mockRes()
    const next = vi.fn()

    await requireUser(mockReq('Bearer good-token'), res, next)

    expect(res.statusCode).toBe(501)
    expect(res.payload.error).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
    expect(next).not.toHaveBeenCalled()
  })
})
