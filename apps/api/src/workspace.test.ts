import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  type CompanyIdentityInput,
  currentWorkspaceEndpoint,
  updateCompanyIdentityEndpoint,
  withCheckDigit,
} from '@edi-bridge/contracts'

import { otherWorkspace, ownWorkspace, startTestApi, type TestApi } from './testing.js'

const ownGln = withCheckDigit('021234500000')

const otherGln = withCheckDigit('029876500000')

let api: TestApi

beforeAll(async () => {
  api = await startTestApi()
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const getCurrentWorkspace = (target = api.admin) =>
  target.inject({ method: 'GET', url: currentWorkspaceEndpoint.path })

const updateIdentity = (body: Partial<CompanyIdentityInput>, target = api.admin) =>
  target.inject({ method: 'PUT', url: updateCompanyIdentityEndpoint.path, body })

beforeEach(async () => {
  await updateIdentity({ gln: ownGln })
})

describe('GET /workspaces/current', () => {
  it('returns the Workspace of the signed-in member', async () => {
    const response = await getCurrentWorkspace()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ...ownWorkspace, gln: ownGln })
  })

  it('returns another Workspace for a member of that Workspace', async () => {
    const response = await getCurrentWorkspace(api.otherAdmin)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(otherWorkspace)
  })

  it('answers 401 without a session', async () => {
    const response = await getCurrentWorkspace(api.app)

    expect(response.statusCode).toBe(401)
  })
})

describe('PUT /workspaces/current/identity', () => {
  it('stores the GLN of the company identity', async () => {
    const response = await updateIdentity({ gln: otherGln })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ...ownWorkspace, gln: otherGln })

    const current = await getCurrentWorkspace()

    expect(current.json()).toEqual({ ...ownWorkspace, gln: otherGln })
  })

  it.each([
    ['a wrong check digit', { gln: `${otherGln.slice(0, 12)}0` }],
    ['too few digits', { gln: '12345' }],
    ['no GLN', {}],
  ])('rejects a GLN with %s', async (_case, body) => {
    const response = await updateIdentity(body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')

    const current = await getCurrentWorkspace()

    expect(current.json()).toEqual({ ...ownWorkspace, gln: ownGln })
  })

  it('answers 401 without a session and changes nothing', async () => {
    const response = await updateIdentity({ gln: otherGln }, api.app)

    expect(response.statusCode).toBe(401)
    expect((await getCurrentWorkspace()).json()).toEqual({ ...ownWorkspace, gln: ownGln })
  })
})
