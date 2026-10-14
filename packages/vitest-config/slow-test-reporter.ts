import type { Reporter, TestCase } from 'vitest/node'

const limitMs = 3000

export default class SlowTestReporter implements Reporter {
  private readonly allowed: ReadonlySet<string>
  private slowTests: { duration: number; name: string }[] = []

  constructor(allowed: readonly string[] = []) {
    this.allowed = new Set(allowed)
  }

  onTestRunStart(): void {
    this.slowTests = []
  }

  onTestCaseResult(testCase: TestCase): void {
    const duration = testCase.diagnostic()?.duration ?? 0

    if (duration > limitMs) {
      this.slowTests.push({
        duration,
        name: `${testCase.module.relativeModuleId} > ${testCase.fullName}`,
      })
    }
  }

  onTestRunEnd(): void {
    if (this.slowTests.length === 0) {
      return
    }

    console.error(`\n${this.slowTests.length} test(s) took longer than ${limitMs} ms:`)

    for (const { duration, name } of this.slowTests) {
      console.error(
        `  ${Math.round(duration)} ms  ${name}${this.allowed.has(name) ? '  (allowed)' : ''}`,
      )
    }

    if (this.slowTests.some(({ name }) => !this.allowed.has(name))) {
      process.exitCode = 1
    }
  }
}
