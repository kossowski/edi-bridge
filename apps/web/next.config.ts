import createNextIntlPlugin from 'next-intl/plugin'

import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@edi-bridge/ui'],
}

export default withNextIntl(nextConfig)
