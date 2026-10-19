import { z } from 'zod'

import {
  channelsEndpoint,
  type Endpoint,
  type ManualSubmissionInput,
  type SignInBody,
  signInEndpoint,
  submitDocumentEndpoint,
} from '@edi-bridge/contracts'

export class ApiError extends Error {}

const errorBodySchema = z.object({ message: z.string().min(1) })

async function failureMessage(response: Response) {
  const body = errorBodySchema.safeParse(await response.json().catch(() => null))

  return body.success ? body.data.message : `HTTP ${response.status} ${response.statusText}`
}

// better-auth accepts a sign-in only with an Origin it trusts, which includes its own base URL.
export function apiClient(apiUrl: string, origin: string) {
  let cookie: string | null = null

  async function request<Response, Body>(
    endpoint: Endpoint<Response, undefined, Body>,
    body?: Body,
  ): Promise<Response> {
    const url = new URL(
      endpoint.path.replace(/^\//, ''),
      apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`,
    )

    const json = endpoint.body === undefined ? undefined : JSON.stringify(endpoint.body.parse(body))
    const headers = new Headers({ origin })

    if (json !== undefined) {
      headers.set('content-type', 'application/json')
    }

    if (cookie !== null) {
      headers.set('cookie', cookie)
    }

    let response: globalThis.Response

    try {
      response = await fetch(
        url,
        json === undefined
          ? { method: endpoint.method, headers }
          : { method: endpoint.method, headers, body: json },
      )
    } catch (error) {
      throw new ApiError(`The API at ${apiUrl} is not reachable`, { cause: error })
    }

    if (!response.ok) {
      throw new ApiError(`${endpoint.method} ${endpoint.path}: ${await failureMessage(response)}`)
    }

    const setCookies = response.headers.getSetCookie()

    if (setCookies.length > 0) {
      cookie = setCookies.map((setCookie) => setCookie.split(';', 1)[0]).join('; ')
    }

    const parsed = endpoint.response.safeParse(await response.json())

    if (!parsed.success) {
      throw new ApiError(
        `${endpoint.method} ${endpoint.path}: unexpected response\n${z.prettifyError(parsed.error)}`,
      )
    }

    return parsed.data
  }

  return {
    signIn: (credentials: SignInBody) => request(signInEndpoint, credentials),
    channels: () => request(channelsEndpoint),
    submitDocument: (input: ManualSubmissionInput) => request(submitDocumentEndpoint, input),
  }
}
