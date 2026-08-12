import { supabaseConfigured, userIdFromToken } from './supabase.js'

/**
 * Express middleware that resolves the caller from their Supabase access
 * token and puts the id on `req.userId`.
 *
 * The server previously accepted any caller, which was survivable while it
 * only minted Plaid link tokens. Anything that reads or writes user rows must
 * sit behind this — otherwise one signed-in user could operate on another's
 * data just by changing an id in the request.
 */
export async function requireUser(req, res, next) {
  if (!supabaseConfigured) {
    return res.status(501).json({
      error:
        'This endpoint needs Supabase. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to server/.env.',
    })
  }

  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null

  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token.' })
  }

  const userId = await userIdFromToken(token)
  if (!userId) {
    return res.status(401).json({ error: 'Invalid or expired session.' })
  }

  req.userId = userId
  next()
}
