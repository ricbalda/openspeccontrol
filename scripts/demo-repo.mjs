// Create a small, disposable OpenSpec repo for demos, screenshots and tutorials.
//
//   node scripts/demo-repo.mjs [folder] [--tools claude|codebuddy|codex|opencode]
//                                        (folder defaults to ./demo-repos)
//
// Makes <folder>/hello-app: a git repo holding a tiny zero-dependency Node HTTP
// app (node:http + node:test, so `npm test` works without npm install), one
// main spec and one active change ("add-hello-endpoint") whose proposal, design,
// delta spec and tasks are all written, so it opens in OpenSpecControl's "In review"
// stage right away, and whose three tasks the agent can really implement.
// --tools also runs `openspec init --tools <agent>`, which installs the /opsx
// workflow commands so "Send review", "Build it" etc. work with that agent
// (without it, OpenSpecControl's own "Initialize OpenSpec" screen is skipped,
// because openspec/ already exists). Add <folder> in OpenSpecControl with "Add folder…".
// Run it again to reset the demo.
//
// The file tree lives in demo-repo-files.mjs, shared with the desktop module
// src/main/desktop/demo-repo.ts (Fase 5.7); this script keeps synchronous IO
// because it runs from a terminal, while the desktop port is fully async.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DEMO_CHANGE, DEMO_REPO_NAME, demoFiles } from './demo-repo-files.mjs'

const argv = process.argv.slice(2)
const toolsAt = argv.indexOf('--tools')
const tools = toolsAt >= 0 ? argv.splice(toolsAt, 2)[1] : null
if (toolsAt >= 0 && !tools) {
  console.error('--tools needs a value, e.g. --tools claude')
  process.exit(1)
}
const root = path.resolve(argv[0] ?? 'demo-repos')
const repo = path.join(root, DEMO_REPO_NAME)

const today = new Date().toISOString().slice(0, 10)
const files = demoFiles(today)

fs.rmSync(repo, { recursive: true, force: true })
for (const [rel, text] of Object.entries(files)) {
  const f = path.join(repo, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, text)
}

if (tools) {
  // npm CLIs are .cmd shims on Windows, which need a shell to start
  const r = spawnSync(
    process.env.OPENSPEC_BIN || 'openspec',
    ['init', '--tools', tools, '--no-animation', process.platform === 'win32' ? `"${repo}"` : repo],
    {
      cwd: repo,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, OPENSPEC_TELEMETRY: process.env.OPENSPEC_TELEMETRY ?? '0' }
    }
  )
  if (r.status !== 0) {
    console.error(
      'openspec init failed (is the OpenSpec CLI installed? npm i -g @fission-ai/openspec)'
    )
    process.exit(1)
  }
}

// a git repo is what OpenSpecControl's folder scan looks for (an openspec/ folder also counts)
const git = (...args) => spawnSync('git', args, { cwd: repo, stdio: 'ignore' }).status === 0
if (git('init', '-q')) {
  git('add', '-A')
  git('-c', 'user.name=demo', '-c', 'user.email=demo@example.com', 'commit', '-qm', 'demo repo')
} else {
  console.warn(
    'git not found: created the files without a git repo (OpenSpecControl still finds it via openspec/)'
  )
}

console.log(`Demo repo ready: ${repo}`)
console.log(`In OpenSpecControl: repo menu → Add folder… → ${root}`)
console.log(`Change "${DEMO_CHANGE}" is waiting in "In review".`)
