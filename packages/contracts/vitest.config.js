import { configDefaults, defineConfig } from 'vitest/config'

import SlowTestReporter from '@edi-bridge/vitest-config/slow-test-reporter'

export default defineConfig({
  test: { reporters: [...configDefaults.reporters, new SlowTestReporter()] },
})
