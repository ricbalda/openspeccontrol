// The renderer's core client: the same object Studio had over HTTP, now a thin
// wrapper over the preload bridge (Fase 3). Signatures are unchanged, so
// store.ts and the components kept their calls; errors arrive as rejected
// promises with the core's own message (the preload unfolds the envelope).

import type { LifecycleAction } from '@shared/protocol.ts'
import type { CommentCreateBody, CommentPatchBody, GitCommitBody } from '@shared/ipc.ts'

export const api = {
  config: () => window.osc.config(),
  update: () => window.osc.update(),
  git: (repo: string, scope: { change?: string; archived?: string } = {}) =>
    window.osc.git(repo, scope),
  gitBranch: (repo: string, change: string) => window.osc.gitBranch(repo, change),
  gitCommit: (b: GitCommitBody) => window.osc.gitCommit(b),
  repos: (refresh = false) => window.osc.repos(refresh),
  addRoot: (path: string) => window.osc.addRoot(path),
  removeRoot: (path: string) => window.osc.removeRoot(path),
  init: (repo: string, agent: string) => window.osc.init(repo, agent),
  changes: (repo: string) => window.osc.changes(repo),
  archived: (repo: string, name: string) => window.osc.archived(repo, name),
  settings: (repo: string, reviewInRepo: boolean) => window.osc.settings(repo, reviewInRepo),
  file: (repo: string, path: string) => window.osc.file(repo, path),
  action: (repo: string, action: LifecycleAction, change?: string, text?: string) =>
    window.osc.action(repo, action, change, text),
  review: (repo: string, change: string) => window.osc.review(repo, change),
  addComment: (c: CommentCreateBody) => window.osc.addComment(c),
  patchComment: (id: string, patch: CommentPatchBody) => window.osc.patchComment(id, patch),
  deleteComment: (id: string) => window.osc.deleteComment(id),
  sendReview: (repo: string, change: string) => window.osc.sendReview(repo, change),
  closeRound: (repo: string, change: string) => window.osc.closeRound(repo, change),
  // Fase 5: native integrations
  pickFolder: () => window.osc.pickFolder(),
  notify: (n: Parameters<typeof window.osc.notify>[0]) => window.osc.notify(n),
  openExternal: (url: string) => window.osc.openExternal(url),
  setNativeTheme: (t: 'light' | 'dark' | 'system') => window.osc.setNativeTheme(t),
  openDataFolder: () => window.osc.openDataFolder(),
  showInExplorer: (repo: string) => window.osc.showInExplorer(repo),
  createDemoRepo: (agent: string | null) => window.osc.createDemoRepo(agent)
}
