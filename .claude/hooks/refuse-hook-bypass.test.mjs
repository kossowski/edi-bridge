import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const script = fileURLToPath(new URL('./refuse-hook-bypass.mjs', import.meta.url))

function runHook(input) {
  return spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: 'utf8' })
}

function bash(command) {
  return { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }
}

const refused = [
  'git commit --no-verify -m "fix: x"',
  'git commit -m "fix: x" --no-verify',
  'git commit --no-veri -m "fix: x"',
  'git push --no-verify',
  'git push origin HEAD --no-verify',
  'git merge --no-verify feature',
  'git commit -n -m "fix: x"',
  'git commit -nm "fix: x"',
  'git commit -anm "fix: x"',
  'git commit -m "fix: x" -n',
  'cd /tmp/repo && git commit -n -m x',
  'git add . && git commit -nm wip',
  'git -C /tmp/repo commit -n -m x',
  'git --no-pager commit -n -m x',
  'HUSKY=0 git commit -m "fix: x"',
  "HUSKY='0' git push",
  'export HUSKY=0; git commit -m x',
  'env HUSKY=0 git commit -m x',
  'git -c core.hooksPath=/dev/null commit -m x',
  'git -c core.hookspath=/dev/null commit -m x',
  'git -c "core.hooksPath=" push',
  'git --config-env=core.hooksPath=EMPTY commit -m x',
  'git config core.hooksPath /dev/null',
  'git config --local core.hooksPath .git/hooks',
  'git config --unset core.hooksPath',
  'git config set core.hooksPath /dev/null',
  'GIT_CONFIG_PARAMETERS="\'core.hooksPath\'=\'/dev/null\'" git commit -m x',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
  'bash -c "git commit --no-verify -m x"',
  "sh -c 'git commit -nm x'",
  'eval "git push --no-verify"',
  'echo start\ngit commit --no-verify -m x',
  '(cd /tmp/repo && git commit -n -m x)',
  'git commit -m "$(cat <<\'EOF\'\nfix: x\nEOF\n)" --no-verify',
]

const allowed = [
  'git commit -m "fix: x"',
  'git commit -am "fix: x"',
  'git commit -mn',
  'git commit -m "fix: x" -m "body that mentions --no-verify and -n"',
  'git commit -m "docs: never use --no-verify"',
  "git commit -m 'never set HUSKY=0 or core.hooksPath'",
  'git commit -m --no-verify',
  'git commit -F - <<\'EOF\'\nfix: x\n\ngit commit --no-verify is refused\nHUSKY=0 git push\nEOF',
  'git commit -m "$(cat <<\'EOF\'\nfix: x\n\nnever run git commit -n\nEOF\n)"',
  'git push',
  'git push -u origin feat/470-2-refuse-hook-bypass',
  'git push -n',
  'git merge -n feature',
  'git revert -n HEAD',
  'git log --no-walk',
  'git log --oneline -n 5',
  'git rebase --no-verify-signatures main',
  'git config core.hooksPath',
  'git config --get core.hooksPath',
  'git config get core.hooksPath',
  'git -c user.name=Bot commit -m x',
  'HUSKY=1 git commit -m x',
  'echo HUSKY=0',
  'echo git commit --no-verify',
  'grep -rn -- --no-verify .agents',
  'rg "core.hooksPath" .husky',
  'pnpm test',
  '',
]

describe('refuse-hook-bypass', () => {
  for (const command of refused) {
    it(`refuses ${JSON.stringify(command)}`, () => {
      const result = runHook(bash(command))
      assert.equal(result.status, 2, result.stderr)
      assert.match(result.stderr, /fix what the hook reports/)
    })
  }

  for (const command of allowed) {
    it(`allows ${JSON.stringify(command)}`, () => {
      const result = runHook(bash(command))
      assert.equal(result.status, 0, result.stderr)
    })
  }

  it('allows other tools', () => {
    const result = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'a.md', content: 'git commit --no-verify' },
    })
    assert.equal(result.status, 0, result.stderr)
  })
})
