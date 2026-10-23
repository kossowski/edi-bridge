import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, it } from 'node:test'

const scripts = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url))

const fakeHerdr = `#!/usr/bin/env bash
echo "herdr $*" >>"$FAKE_DIR/herdr.log"
case "$1 $2" in
  "agent list") cat "$FAKE_DIR/agents.json" ;;
  "agent read") echo "Allow this command?" ;;
  "workspace list") echo '{"result":{"workspaces":[{"workspace_id":"w9","label":"edi-bridge","focused":false}]}}' ;;
  "tab create") echo '{"result":{"root_pane":{"pane_id":"p7"}}}' ;;
  "agent prompt") echo '{"result":{"agent":{"name":"'"$3"'","tab_id":"w9:t1","agent_status":"working"}}}' ;;
esac
`

const fakeGh = `#!/usr/bin/env bash
if [ "$1" = repo ]; then echo acme/edi; exit 0; fi
path=$2 filter=$4
file="$FAKE_DIR/gh/$(echo "\${path%%\\?*}" | tr / _).json"
jq "$filter" "$file"
`

const fakeFree = `#!/usr/bin/env bash
echo "              total        used        free      shared  buff/cache   available"
echo "Mem:          11700        4000        5000           0        2700        7000"
echo "Swap:             0           0           0"
`

let dir

function writeExecutable(path, content) {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function agents(list) {
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ result: { agents: list } }))
}

function run(script, args, env = {}) {
  return spawnSync('bash', [join(scripts, script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 8000,
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      FAKE_DIR: dir,
      AGENTS_INBOX: join(dir, 'inbox'),
      WATCH_POLL_SECONDS: '0.2',
      ...env,
    },
  })
}

function herdrCalls() {
  try {
    return readFileSync(join(dir, 'herdr.log'), 'utf8')
  } catch {
    return ''
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lead-scripts-'))
  mkdirSync(join(dir, 'bin'))
  mkdirSync(join(dir, 'gh'))
  mkdirSync(join(dir, 'inbox'))
  writeExecutable(join(dir, 'bin', 'herdr'), fakeHerdr)
  writeExecutable(join(dir, 'bin', 'gh'), fakeGh)
  writeExecutable(join(dir, 'bin', 'free'), fakeFree)
  agents([{ name: 'ticket-57', tab_id: 'w9:t1', agent_status: 'working' }])
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('watch.sh', () => {
  it('prints an inbox message and returns at once', () => {
    writeFileSync(join(dir, 'inbox', '57-20261023T100000Z-report.md'), 'ready for /land\n')
    const r = run('watch.sh', [])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /ready for \/land/)
    assert.match(r.stdout, /INBOX: 1 message\(s\), oldest 57-20261023T100000Z-report\.md 0 min/)
    assert.doesNotMatch(r.stdout, /STALE/)
  })

  it('prints a STALE line and notifies for a message older than 30 minutes', () => {
    const file = join(dir, 'inbox', '57-20261023T100000Z-report.md')
    writeFileSync(file, 'ready for /land\n')
    const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000)
    utimesSync(file, fortyMinutesAgo, fortyMinutesAgo)
    const r = run('watch.sh', [])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /STALE: 57-20261023T100000Z-report\.md unanswered for 40 min/)
    assert.match(herdrCalls(), /herdr notification show Lead inbox: STALE/)
  })

  it('returns on a blocked ticket lead, once per block', () => {
    agents([{ name: 'ticket-57', tab_id: 'w9:t1', agent_status: 'blocked' }])
    const first = run('watch.sh', [])
    assert.equal(first.status, 0)
    assert.match(first.stdout, /ticket-57 BLOCKED/)
    assert.match(first.stdout, /Allow this command\?/)
    assert.match(herdrCalls(), /herdr notification show Lead: ticket lead blocked/)

    const second = run('watch.sh', ['1'])
    assert.equal(second.status, 0)
    assert.match(second.stdout, /^HEARTBEAT/)
    assert.match(second.stdout, /ticket-57 w9:t1 blocked/)
  })

  it('ends with a heartbeat when nothing happens', () => {
    const r = run('watch.sh', ['0'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^HEARTBEAT: RAM 7000MB available/)
    assert.match(r.stdout, /ticket-57 w9:t1 working/)
  })
})

describe('board.sh', () => {
  function issue(number, labels, blockedBy, blocking, state = 'open') {
    return {
      number,
      title: `Ticket ${number}`,
      state,
      labels: labels.map((name) => ({ name })),
      issue_dependencies_summary: { blocked_by: blockedBy, blocking },
    }
  }

  it('lists runnable tickets first, the one that blocks the most on top', () => {
    writeFileSync(
      join(dir, 'gh', 'repos_acme_edi_issues_156_sub_issues.json'),
      JSON.stringify([
        issue(57, ['ready-for-agent', 'web'], 0, 0),
        issue(58, ['ready-for-agent', 'api'], 0, 0),
        issue(59, ['ready-for-agent', 'api'], 0, 3),
        issue(60, ['ready-for-agent', 'api'], 1, 0),
        issue(61, ['ready-for-human', 'web'], 0, 0),
        issue(62, ['ready-for-agent', 'web'], 0, 0, 'closed'),
      ]),
    )
    const r = run('board.sh', ['156'])
    assert.equal(r.status, 0, r.stderr)
    const lines = r.stdout.trim().split('\n')
    assert.match(lines[0], /^#59 +runnable +blocks 3 +api/)
    assert.match(lines[1], /^#58 +runnable +blocks 0 +api/)
    assert.match(r.stdout, /#57 +running +blocks 0 +web/)
    assert.match(r.stdout, /#60 +blocked by 1/)
    assert.match(r.stdout, /#61 +ready-for-human/)
    assert.match(r.stdout, /#62 +closed/)
    assert.equal(lines.filter((l) => / runnable /.test(l)).length, 2)
  })

  it('marks a runnable ticket that shares an area with a running one', () => {
    writeFileSync(
      join(dir, 'gh', 'repos_acme_edi_issues_156_sub_issues.json'),
      JSON.stringify([issue(57, ['ready-for-agent', 'web'], 0, 0), issue(63, ['ready-for-agent', 'web'], 0, 0)]),
    )
    const r = run('board.sh', ['156'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /#63 +runnable .*overlaps web/)
  })
})

describe('spawn-ticket-lead.sh', () => {
  it('opens a ticket-<NN> tab and prompts /ticket-lead with the lead session', () => {
    const r = run('spawn-ticket-lead.sh', ['57', 'edi-bridge-5e'])
    assert.equal(r.status, 0, r.stderr)
    const calls = herdrCalls()
    assert.match(calls, /herdr tab create --workspace w9 --cwd \S+ --label ticket-57 /)
    assert.match(calls, /herdr agent start ticket-57 --kind claude --pane p7 /)
    assert.match(calls, /herdr agent prompt ticket-57 \/ticket-lead 57 \. An engineering lead started you: session edi-bridge-5e\./)
    assert.match(r.stdout, /"name":"ticket-57"/)
  })
})
