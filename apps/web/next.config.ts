import createNextIntlPlugin from 'next-intl/plugin'

import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@edi-bridge/contracts',
    '@edi-bridge/edifact',
    '@edi-bridge/mocks',
    '@edi-bridge/ui',
  ],
  redirects: () =>
    Promise.resolve([
      { source: '/runs', destination: '/documents', permanent: true },
      { source: '/runs/:id', destination: '/documents/:id', permanent: true },
      {
        source: '/order-lifecycle',
        has: [{ type: 'query', key: 'businessReference', value: '(?<businessReference>[^/]+)' }],
        destination: '/orders/:businessReference',
        permanent: true,
      },
      {
        source: '/order-lifecycle',
        has: [{ type: 'query', key: 'businessReference', value: '(?<businessReference>.+)' }],
        destination: '/orders?q=:businessReference',
        permanent: true,
      },
      { source: '/order-lifecycle', destination: '/orders', permanent: true },
    ]),
}

export default withNextIntl(nextConfig)
