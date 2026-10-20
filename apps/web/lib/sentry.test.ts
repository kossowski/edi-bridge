import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ErrorEvent, NodeOptions } from '@sentry/nextjs'

import {
  browserSentryOptions,
  sentryBuildOptions,
  sentryConfig,
  serverIntegrations,
  serverSentryOptions,
} from './sentry'

type SpanJSON = Parameters<NonNullable<NodeOptions['beforeSendSpan']>>[0]

const dsn = 'https://key@sentry.example/1'

const documentFragment = "UNH+1+ORDERS:D:96A:UN'BGM+220+4711'"

const span = (overrides: Partial<SpanJSON>): SpanJSON => ({
  trace_id: 'trace',
  span_id: 'span',
  name: 'GET /orders',
  start_timestamp: 0,
  status: 'error',
  is_segment: true,
  attributes: {},
  ...overrides,
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the Sentry config', () => {
  it('leaves Sentry off without a DSN', () => {
    expect(sentryConfig({ SENTRY_ENVIRONMENT: 'production' })).toBeUndefined()
    expect(sentryConfig({ SENTRY_DSN: '' })).toBeUndefined()
  })

  it('samples a tenth of the traces by default', () => {
    expect(sentryConfig({ SENTRY_DSN: dsn })).toEqual({
      dsn,
      environment: undefined,
      tracesSampleRate: 0.1,
    })
    expect(
      sentryConfig({ SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: '', SENTRY_TRACES_SAMPLE_RATE: '' }),
    ).toEqual({ dsn, environment: undefined, tracesSampleRate: 0.1 })
  })

  it('takes the environment and the sample rate', () => {
    expect(
      sentryConfig({
        SENTRY_DSN: dsn,
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_TRACES_SAMPLE_RATE: '0.2',
      }),
    ).toEqual({ dsn, environment: 'staging', tracesSampleRate: 0.2 })
  })

  it('rejects a sample rate outside 0 to 1', () => {
    expect(() => sentryConfig({ SENTRY_DSN: dsn, SENTRY_TRACES_SAMPLE_RATE: '2' })).toThrow(
      /SENTRY_TRACES_SAMPLE_RATE/,
    )
    expect(() => sentryConfig({ SENTRY_DSN: dsn, SENTRY_TRACES_SAMPLE_RATE: 'often' })).toThrow(
      /SENTRY_TRACES_SAMPLE_RATE/,
    )
  })

  it('rejects a DSN that is no URL', () => {
    expect(() => sentryConfig({ SENTRY_DSN: 'not a dsn' })).toThrow(/SENTRY_DSN/)
  })
})

describe('the browser Sentry options', () => {
  it('leave Sentry off without NEXT_PUBLIC_SENTRY_DSN', () => {
    vi.stubEnv('SENTRY_DSN', dsn)

    expect(browserSentryOptions()).toBeUndefined()
  })

  it('read the NEXT_PUBLIC_ variables', () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn)
    vi.stubEnv('NEXT_PUBLIC_SENTRY_ENVIRONMENT', 'staging')
    vi.stubEnv('NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE', '0.3')

    expect(browserSentryOptions()).toMatchObject({
      dsn,
      environment: 'staging',
      tracesSampleRate: 0.3,
    })
  })

  it('name the NEXT_PUBLIC_ variable of an invalid value', () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn)
    vi.stubEnv('NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE', '2')

    expect(() => browserSentryOptions()).toThrow(/NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE/)
  })

  it('collect no user, cookies, headers, bodies, queries or variables and drop every breadcrumb', () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn)

    const options = browserSentryOptions()

    expect(options?.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    })
    expect(options?.beforeBreadcrumb?.({ message: 'GET /api/runs' })).toBeNull()
  })
})

describe('the server Sentry options', () => {
  it('leave Sentry off without SENTRY_DSN', () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn)

    expect(serverSentryOptions()).toBeUndefined()
  })

  it('read the server variables', () => {
    vi.stubEnv('SENTRY_DSN', dsn)
    vi.stubEnv('SENTRY_ENVIRONMENT', 'production')

    expect(serverSentryOptions()).toMatchObject({
      dsn,
      environment: 'production',
      tracesSampleRate: 0.1,
    })
  })

  it('keep only the integrations that report crashes', () => {
    vi.stubEnv('SENTRY_DSN', dsn)

    const names = [
      'Http',
      'NodeFetch',
      'Console',
      'NodeSystemError',
      'LinkedErrors',
      'DistDirRewriteFrames',
    ]

    expect(serverSentryOptions()?.integrations).toBe(serverIntegrations)
    expect(serverIntegrations(names.map((name) => ({ name }))).map(({ name }) => name)).toEqual([
      'LinkedErrors',
      'DistDirRewriteFrames',
    ])
  })
})

describe('an event', () => {
  const beforeSend = () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn)

    const options = browserSentryOptions()

    if (options?.beforeSend === undefined) {
      throw new TypeError('The options scrub events')
    }

    return options.beforeSend
  }

  it('keeps only the method and the path of the request', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: 'https://edi-bridge.example.com/orders?q=4711',
        method: 'POST',
        query_string: 'q=4711',
        data: 'UNA:+.? ',
        cookies: { session: 'secret' },
        headers: { cookie: 'session=secret', authorization: 'Bearer secret' },
      },
    }

    expect(beforeSend()(event, {})).toEqual({
      type: undefined,
      request: { url: 'https://edi-bridge.example.com/orders', method: 'POST' },
    })
  })

  it('carries no message and only the type of each exception', () => {
    const event: ErrorEvent = {
      type: undefined,
      message: `Cannot map ${documentFragment}`,
      logentry: { message: `Cannot map ${documentFragment}` },
      exception: {
        values: [
          { type: 'TypeError', value: `Cannot read ${documentFragment}` },
          { value: documentFragment },
        ],
      },
    }

    const scrubbed = beforeSend()(event, {})

    expect(JSON.stringify(scrubbed)).not.toContain('ORDERS')
    expect(scrubbed).toEqual({
      type: undefined,
      exception: { values: [{ type: 'TypeError', value: 'TypeError' }, { value: 'Error' }] },
    })
  })
})

describe('a server event', () => {
  const beforeSend = () => {
    vi.stubEnv('SENTRY_DSN', dsn)

    const options = serverSentryOptions()

    if (options?.beforeSend === undefined) {
      throw new TypeError('The options scrub events')
    }

    return options.beforeSend
  }

  it('carries no system error, whose path can name the file of a Trading Partner', () => {
    // Joined at runtime, so that ContextLines cannot copy the file name from this source.
    const path = ['/sftp/inbox', `partner-${crypto.randomUUID()}.edi`].join('/')

    const event: ErrorEvent = {
      type: undefined,
      contexts: {
        node_system_error: { errno: -2, code: 'ENOENT', syscall: 'open', path },
        runtime: { name: 'node' },
      },
    }

    const scrubbed = beforeSend()(event, {})

    expect(JSON.stringify(scrubbed)).not.toContain(path)
    expect(scrubbed).toEqual({ type: undefined, contexts: { runtime: { name: 'node' } } })
  })
})

describe('a span', () => {
  const beforeSendSpan = () => {
    vi.stubEnv('SENTRY_DSN', dsn)

    const options = serverSentryOptions()

    if (options?.beforeSendSpan === undefined) {
      throw new TypeError('The options scrub spans')
    }

    return options.beforeSendSpan
  }

  it('carries no status message', () => {
    const scrubbed = beforeSendSpan()(
      span({ attributes: { 'sentry.status.message': documentFragment, 'http.route': '/orders' } }),
    )

    expect(scrubbed.attributes).toEqual({ 'http.route': '/orders' })
  })

  it('carries no query of a URL', () => {
    const token = 'reset-token-4711'

    const scrubbed = beforeSendSpan()(
      span({
        name: `GET /reset-password?token=${token}`,
        attributes: {
          'url.full': `https://edi-bridge.example.com/api/auth/reset-password?token=${token}`,
          'url.path': `/api/auth/reset-password?token=${token}`,
          'url.query': `token=${token}`,
          'http.target': `/reset-password?token=${token}#top`,
          'http.url': `https://edi-bridge.example.com/api/auth/reset-password?token=${token}`,
          'http.query': `?token=${token}`,
          'next.span_name': `GET /reset-password?token=${token}`,
          url: `/api/auth/reset-password?token=${token}`,
        },
      }),
    )

    expect(JSON.stringify(scrubbed)).not.toContain(token)
    expect(scrubbed).toMatchObject({
      name: 'GET /reset-password',
      attributes: {
        'url.full': 'https://edi-bridge.example.com/api/auth/reset-password',
        'http.target': '/reset-password',
      },
    })
  })
})

describe('the Sentry build options', () => {
  const complete = {
    SENTRY_AUTH_TOKEN: 'token',
    SENTRY_ORG: 'edi-bridge',
    SENTRY_PROJECT: 'web',
  }

  const stub = (env: Record<string, string>) => {
    for (const [name, value] of Object.entries(env)) {
      vi.stubEnv(name, value)
    }
  }

  it('upload source maps and create a release with an auth token, an org and a project', () => {
    stub(complete)

    expect(sentryBuildOptions()).toMatchObject({
      authToken: 'token',
      org: 'edi-bridge',
      project: 'web',
      sourcemaps: { disable: false },
      release: { create: true },
    })
  })

  it.each(Object.keys(complete))('upload nothing without %s', (missing) => {
    stub({ ...complete, [missing]: '' })

    const options = sentryBuildOptions()

    expect(options.sourcemaps?.disable).toBe(true)
    expect(options.release?.create).toBe(false)
    expect(options.authToken).toBeUndefined()
  })
})
