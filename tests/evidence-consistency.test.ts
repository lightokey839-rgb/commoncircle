import { describe, expect, it } from 'vitest'
import manifest from '../evidence/evidence.json'
import status from '../web/evidence-status.json'

// web/evidence-status.json is written by `npm run claims` from evidence/evidence.json.
// The Evidence & tracks page shows it as-is, so it must list exactly the manifest's claims.
describe('evidence shown in the app matches the claims manifest', () => {
  const claims = (manifest as { claims: Array<{ id: string; track: string }> }).claims
  const shown = (status as { claims: Array<{ id: string; track: string; status: string }> }).claims

  it('has the same claim ids and tracks, none dropped or invented', () => {
    expect(shown.map((c) => `${c.id}|${c.track}`).sort()).toEqual(claims.map((c) => `${c.id}|${c.track}`).sort())
  })

  it('covers only the three hackathon tracks (7 / 12 / 17 today)', () => {
    const count = (t: string) => claims.filter((c) => c.track === t).length
    expect(new Set(claims.map((c) => c.track))).toEqual(new Set(['NFTs That Do Something', 'Social Money', 'Open Innovation']))
    expect([count('NFTs That Do Something'), count('Social Money'), count('Open Innovation')]).toEqual([7, 12, 17])
  })

  it('every status is a harness result (PASS or FAIL), never blank', () => {
    for (const c of shown) expect(['PASS', 'FAIL']).toContain(c.status)
  })
})
