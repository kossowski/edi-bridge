# @edi-bridge/edifact

Parses, validates and serializes EDIFACT Interchanges. The golden files that the tests use are described in [`golden/README.md`](golden/README.md).

## Mutation testing

Mutation testing checks how well the tests detect changes to the code. [Stryker](https://stryker-mutator.io/) changes the source in small ways, for example it replaces `<` with `<=` or removes a condition. Each changed version is a mutant. Stryker runs the tests against each mutant:

- **Killed**: a test fails, so the tests detect the change.
- **Survived**: all tests pass, so no test detects the change.
- **Timeout**: the tests do not finish, which Stryker counts as detected.
- **No coverage**: no test runs the changed code.

The mutation score is the share of detected mutants (killed and timeout) among all mutants.

Mutation testing is not part of `check:fast`, `check`, the git hooks or CI. Run it by hand:

```bash
pnpm --filter @edi-bridge/edifact test:mutation
```

Stryker mutates the files in `src/`, but not the test files, and runs at most 2 workers. The configuration is in `stryker.config.json`.

The repo patches `@stryker-mutator/vitest-runner` for Vitest 5 ([stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210), fixed by [stryker-js#6214](https://github.com/stryker-mutator/stryker-js/pull/6214)). The header of `patches/@stryker-mutator__vitest-runner@10.0.0.patch` says when to remove the patch.

### Read the report

The terminal shows the mutation score per file and lists each surviving mutant with its file, line and change.

The HTML report is in `reports/mutation/index.html`. Git ignores this folder. Open the file in a browser and select a file to see its source with each mutant on its line. Select a mutant to see the change and its status. A surviving mutant shows a gap in the tests, or a change that does not alter the behaviour (an equivalent mutant).

The vitest runner also reports a mutant as Survived when the mutant stops the test file from loading, because then no test runs ([stryker-js#6150](https://github.com/stryker-mutator/stryker-js/issues/6150)). So the reported score is lower than the real one. On this package, the first run with the patched runner scored 20.53 %, and the same run with `testRunner: "command"` scored 48.75 %: 877 mutants were of this kind. To find them, look for Survived mutants with 0 tests completed.
