# OpenSpecControl

**A desktop mission control for spec-driven development with AI coding agents.**

OpenSpecControl helps you turn an idea into an [OpenSpec](https://github.com/Fission-AI/OpenSpec) proposal with the help of an AI coding agent, review it like a document, hand it off to [Orca](https://www.onorca.dev/) for implementation, and keep track of many changes running in parallel from a single window.

> **Status: early development.** This README describes the intended feature set. Features marked **(planned)** are not implemented yet; features marked **(from openspec-studio)** are inherited from the upstream project this app is built on.

---

## Features

### 1. Proposal generation with your agent of choice
- Generate OpenSpec proposals (`proposal.md`, `design.md`, `tasks.md`, spec deltas) from a plain-language requirement.
- Works with **Claude Code**, **Codex** and **opencode** through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/), plus custom agents via configuration. **(from openspec-studio)**
- Uses each agent's native OpenSpec commands (`/opsx:*`, `$openspec-*`, `/opsx-*`), so the output is the same as running OpenSpec in a terminal. **(from openspec-studio)**
- Live agent panel: messages, tool calls, plans, token/context usage, and permission or question prompts that you answer from the UI. **(from openspec-studio)**
- Choose the agent and model per session; resume previous sessions. **(from openspec-studio)**

### 2. Document-style review
- Comment on proposals, designs and specs by text selection or by block, with typed comments: *Change*, *Question*, *Remove*, *Comment*, *Approve*. **(from openspec-studio)**
- Send all comments to the agent as a review round, get a verdict per comment, and see word-level diffs between revisions. **(from openspec-studio)**
- Built-in validation with `openspec validate` and warnings for stale artifacts. **(from openspec-studio)**

### 3. Human-approved handoff to Orca
- Nothing is implemented until you approve the proposal. **(planned)**
- On approval, OpenSpecControl creates an isolated Orca worktree for the change, places the change files in it and launches the implementation agent with the right apply command. **(planned)**
- One change maps to one worktree and one agent, so parallel changes never overwrite each other. **(planned)**
- Execution backends are pluggable: **Orca** (parallel worktrees, terminals, diffs) or **direct ACP** (no Orca required). **(planned)**

### 4. Multi-change monitoring board
- One board for every change across your repositories, grouped by stage: *Drafting*, *In review*, *Ready to build*, *Building*, *Verifying*, *Done*. **(partly from openspec-studio, extended)**
- Per-change progress read from `tasks.md` and `openspec list --json` inside each worktree, updated in real time through file watching. **(planned)**
- Agent liveness and idle detection from Orca (polling `worktree ps` and `terminal wait`), with a "needs attention" flag when a run looks stuck or is waiting for a permission prompt. **(planned)**
- Status written back to Orca (`in-progress`, `in-review`, `completed`, progress comment, unread marker) so both tools tell the same story. **(planned)**
- Overlap detection: warns when two active changes modify the same capability spec, and archives changes one at a time. **(planned)**

### 5. Git and spec lifecycle
- Create a branch for a change and commit only that change's files, on demand. **(from openspec-studio)**
- Read-only view of current specs and of archived changes with their history. **(from openspec-studio)**
- Sync and archive steps run from the UI after review and merge. **(from openspec-studio)**

### 6. Local-first desktop app
- Native desktop app for Windows, macOS and Linux built with Electron. **(planned)**
- All data stays on your machine: SQLite database in the app data folder, no cloud service involved. **(from openspec-studio)**
- Uses the CLIs and logins you already have (`openspec`, `claude`, `codex`, `opencode`, `orca`); OpenSpecControl does not provide models or accounts.
- Native folder picker, notifications and auto-update. **(planned)**

---

## How it works

```
Idea → OpenSpecControl + agent (ACP) → /opsx:propose
     → review with comments and rounds
     → approve
     → Orca worktree + agent launch (/opsx:apply)
     → OpenSpecControl watches tasks.md and Orca state → board
     → review diff → merge → archive
```

OpenSpecControl runs a small local server (Node.js) that talks to the CLIs and watches the `openspec/` folders; the React interface connects to it. The Electron shell packages both as a desktop app.

## Requirements

- Node.js 24 (needed for `node:sqlite`; Node 22.13 or later also works when running outside Electron)
- Git
- [OpenSpec CLI](https://github.com/Fission-AI/OpenSpec) (`npm install -g @fission-ai/openspec`)
- At least one agent CLI, signed in: Claude Code, Codex or opencode
- [Orca](https://www.onorca.dev/) installed and running, for the Orca execution backend (optional)

## Tech stack

TypeScript end to end: Electron, React 19, Vite, Tailwind CSS, Node.js (Hono, WebSocket, chokidar), SQLite (`node:sqlite`), ACP SDK, Zod, Vitest, Biome.

## Known limitations

- The Orca CLI controls a running Orca app and does not publish events, so OpenSpecControl polls it for state.
- Orca does not expose an explicit "waiting for input" state; OpenSpecControl infers it from terminal idleness and unfinished tasks.

## Roadmap

1. Run the upstream base locally with a real agent.
2. Add runs, the Orca client and the multi-change board (web version).
3. Wrap in Electron (native dialogs, app data folder).
4. Packaging, bundled agent adapters, auto-update.

## Security

OpenSpecControl is a local desktop app with no network surface:

- **No ports, no network authentication.** The interface talks to the app core over Electron IPC (`contextBridge`); the app never opens a listening socket. Everything stays on your machine (`~/.openspeccontrol`, the app's data folder, and the repositories you add).
- **Hardened renderer.** The window is created with fixed `webPreferences`: `contextIsolation` and the Chromium sandbox on, `nodeIntegration` off, `webSecurity` on, no spellcheck, and drag-and-drop never navigates. There is no `process` or `require` in the renderer.
- **Strict Content-Security-Policy** (`default-src 'self'`, no objects, no frames, no base): scripts, styles and connections can only come from the app itself. The development server (HMR included) works under the same policy.
- **Deny-by-default permissions.** Every permission request is refused except `clipboard-sanitized-write` (what a copy button needs); `<webview>` tags, `window.open` and in-page navigation are all blocked.
- **Validated IPC.** Every message is checked before any core code runs: only the main window's main frame on the origin the app loaded, arguments validated with zod schemas and size caps, and file access sandboxed to the repositories you added and the data folder.
- **Agents keep their own gates.** Coding agents run with the CLIs you installed (system `node`/`npx`, never the app's Electron), as your user. Their permission and elicitation prompts are relayed to you in the UI; OpenSpecControl never auto-approves a command behind your back.
- **Hardened binary.** Packaged builds flip Electron's fuses: `RunAsNode`, `NODE_OPTIONS` and the `--inspect` CLI switch are disabled, and ASAR integrity validation plus `OnlyLoadAppFromAsar` are enabled.

## Credits and license

OpenSpecControl is built on [openspec-studio](https://github.com/baabullah/openspec-studio) by baabullah (MIT License) and works with [OpenSpec](https://github.com/Fission-AI/OpenSpec) and [Orca](https://github.com/stablyai/orca). License for OpenSpecControl itself: to be defined; derived code keeps its original MIT notice.
