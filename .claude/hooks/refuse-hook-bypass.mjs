import { readFileSync } from 'node:fs'

const SEPARATORS = new Set([';', '&', '|', '(', ')', '\n'])
const COMMAND_PREFIXES = new Set(['env', 'command', 'exec', 'time', 'nohup', 'sudo', 'export'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
const COMMIT_SHORT_OPTIONS_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't'])
const COMMIT_LONG_OPTIONS_WITH_VALUE = new Set([
  '--message',
  '--file',
  '--reuse-message',
  '--reedit-message',
  '--template',
  '--author',
  '--date',
  '--fixup',
  '--squash',
  '--cleanup',
  '--trailer',
  '--pathspec-from-file',
])
const CONFIG_READ_ARGS = new Set(['get', '--get', '--get-all', '--get-regexp', '-l', '--list'])
const CONFIG_WRITE_ARGS = new Set(['set', 'unset', '--unset', '--unset-all', '--add', '--replace-all'])

function tokenize(source) {
  const tokens = []
  const pendingHeredocs = []
  let word = null
  let i = 0

  const flush = () => {
    if (word !== null) tokens.push(word)
    word = null
  }

  while (i < source.length) {
    const char = source[i]

    if (char === '\n' && pendingHeredocs.length > 0) {
      flush()
      tokens.push('\n')
      i++
      for (const { delimiter, stripTabs } of pendingHeredocs.splice(0)) {
        while (i < source.length) {
          const end = source.indexOf('\n', i)
          const line = source.slice(i, end === -1 ? source.length : end)
          i = end === -1 ? source.length : end + 1
          if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) break
        }
      }
      continue
    }

    if (char === '\\' && i + 1 < source.length) {
      if (source[i + 1] !== '\n') word = (word ?? '') + source[i + 1]
      i += 2
      continue
    }

    if (char === "'") {
      const end = source.indexOf("'", i + 1)
      const close = end === -1 ? source.length : end
      word = (word ?? '') + source.slice(i + 1, close)
      i = close + 1
      continue
    }

    if (char === '"') {
      let value = ''
      i++
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\' && '"\\$`\n'.includes(source[i + 1] ?? '')) i++
        value += source[i] ?? ''
        i++
      }
      word = (word ?? '') + value
      i++
      continue
    }

    if (char === '<' && source.startsWith('<<', i) && !source.startsWith('<<<', i)) {
      flush()
      i += 2
      const stripTabs = source[i] === '-'
      if (stripTabs) i++
      while (source[i] === ' ' || source[i] === '\t') i++
      const match = /^(['"]?)([^\s'";&|()<>]+)\1/.exec(source.slice(i))
      if (match) {
        pendingHeredocs.push({ delimiter: match[2], stripTabs })
        i += match[0].length
      }
      continue
    }

    if (char === '#' && word === null) {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }

    if (char === '$' && source[i + 1] === '(') {
      flush()
      tokens.push('(')
      i += 2
      continue
    }

    if (SEPARATORS.has(char)) {
      flush()
      tokens.push(char)
      i++
      continue
    }

    if (char === ' ' || char === '\t') {
      flush()
      i++
      continue
    }

    word = (word ?? '') + char
    i++
  }
  flush()
  return tokens
}

function splitCommands(tokens) {
  const commands = [[]]
  for (const token of tokens) {
    if (SEPARATORS.has(token)) commands.push([])
    else commands.at(-1).push(token)
  }
  return commands.filter((words) => words.length > 0)
}

function assignment(word) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(word)
  return match ? { name: match[1], value: match[2] } : null
}

function isHooksPathKey(key) {
  return key.toLowerCase() === 'core.hookspath'
}

function checkAssignment({ name, value }) {
  if (name === 'HUSKY' && value === '0') return 'HUSKY=0 turns the husky hooks off'
  if (name.startsWith('GIT_CONFIG_') && /core\.hookspath/i.test(value)) {
    return `${name} overrides core.hooksPath`
  }
  return null
}

function checkGit(args) {
  let i = 0
  while (i < args.length && args[i].startsWith('-')) {
    const option = args[i]
    if (option === '-c' && isHooksPathKey((args[i + 1] ?? '').split('=')[0])) {
      return 'git -c core.hooksPath overrides the hooks directory'
    }
    if (option.startsWith('--config-env') && /core\.hookspath/i.test(option + (args[i + 1] ?? ''))) {
      return 'git --config-env core.hooksPath overrides the hooks directory'
    }
    i += GIT_OPTIONS_WITH_VALUE.has(option) || option === '--config-env' ? 2 : 1
  }

  const subcommand = args[i]
  const rest = args.slice(i + 1)
  if (subcommand === undefined) return null
  if (subcommand === 'config') return checkGitConfig(rest)
  if (subcommand === 'commit') return checkGitCommit(rest)
  if (rest.some(isNoVerify)) return `git ${subcommand} --no-verify skips the git hooks`
  return null
}

function isNoVerify(arg) {
  return arg.length >= '--no-v'.length && '--no-verify'.startsWith(arg)
}

function checkGitConfig(args) {
  const keyIndex = args.findIndex(isHooksPathKey)
  if (keyIndex === -1) return null
  const reads = args.some((arg) => CONFIG_READ_ARGS.has(arg))
  const writes = args.some((arg) => CONFIG_WRITE_ARGS.has(arg)) || keyIndex < args.length - 1
  return writes && !reads ? 'git config core.hooksPath changes the hooks directory' : null
}

function checkGitCommit(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') return null
    if (arg.startsWith('--')) {
      if (isNoVerify(arg)) return 'git commit --no-verify skips the git hooks'
      if (COMMIT_LONG_OPTIONS_WITH_VALUE.has(arg)) i++
      continue
    }
    if (!arg.startsWith('-') || arg === '-') continue
    for (let j = 1; j < arg.length; j++) {
      if (arg[j] === 'n') return 'git commit -n skips the git hooks'
      if (COMMIT_SHORT_OPTIONS_WITH_VALUE.has(arg[j])) {
        if (j === arg.length - 1) i++
        break
      }
    }
  }
  return null
}

function checkCommand(words) {
  let i = 0
  while (i < words.length) {
    const word = words[i]
    const parsed = assignment(word)
    if (parsed) {
      const reason = checkAssignment(parsed)
      if (reason) return reason
      i++
    } else if (COMMAND_PREFIXES.has(word)) {
      i++
    } else {
      break
    }
  }

  const program = words[i]?.split('/').at(-1)
  const args = words.slice(i + 1)
  if (program === 'git') return checkGit(args)
  if (program === 'eval') return findBypass(args.join(' '))
  if (SHELLS.has(program)) {
    const script = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
    if (script !== -1 && args[script + 1] !== undefined) return findBypass(args[script + 1])
  }
  return null
}

function findBypass(command) {
  for (const words of splitCommands(tokenize(command))) {
    const reason = checkCommand(words)
    if (reason) return reason
  }
  return null
}

const input = JSON.parse(readFileSync(0, 'utf8'))
const command = input.tool_name === 'Bash' ? input.tool_input?.command : undefined
const reason = typeof command === 'string' ? findBypass(command) : null

if (reason) {
  process.stderr.write(
    `Refused: ${reason}. The git hooks run on every commit and push, also for a temporary fixup commit that a rebase squashes later. Do not bypass them: fix what the hook reports and run the command again.\n`,
  )
  process.exit(2)
}
