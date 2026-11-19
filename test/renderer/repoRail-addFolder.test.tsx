// @vitest-environment jsdom
// Botón "Add folder…" junto al selector de repositorio: visible siempre (con y sin repo),
// a la izquierda del icono del explorador, y abre el diálogo de carpetas.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RepoInfo } from '@shared/protocol.ts'
import { RepoRail } from '../../src/renderer/src/panes/RepoRail.tsx'
import { useStore } from '../../src/renderer/src/store.ts'

window.osc = {
  send: () => {},
  onMessage: () => () => {}
} as unknown as typeof window.osc

let root: Root | null = null
const renderRail = (): HTMLElement => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root!.render(<RepoRail />))
  return el
}
const addButton = (el: HTMLElement): HTMLButtonElement | null =>
  el.querySelector('button[aria-label="Add folder…"]')

const demo = {
  id: '/work/hello-app',
  name: 'hello-app',
  root: '/work',
  rel: 'hello-app',
  openspec: true
} as RepoInfo

beforeEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  root = null
  useStore.setState({ repo: null, repos: [], roots: [], addFolderOpen: false })
})

describe('Add folder button in the repository selector', () => {
  it('is there with no repository and no folders, with an accessible name', () => {
    const el = renderRail()
    const b = addButton(el)
    expect(b).not.toBeNull()
    expect(b!.title).toBe('Add folder…')
    expect(el.querySelector('button[aria-label^="Show "]')).toBeNull()
  })

  it('opens the add-folder dialog', () => {
    const el = renderRail()
    expect(useStore.getState().addFolderOpen).toBe(false)
    act(() => addButton(el)!.click())
    expect(useStore.getState().addFolderOpen).toBe(true)
  })

  it('is there with a repository too, between the selector and the file manager icon', () => {
    useStore.setState({ repo: demo.id, repos: [demo] })
    const el = renderRail()
    const row = addButton(el)!.parentElement!
    const labels = [...row.children].map(
      (c) => c.getAttribute('aria-label') ?? c.textContent?.trim()
    )
    expect(labels[1]).toBe('Add folder…')
    expect(labels[2]).toBe('Show hello-app in the file manager')
    expect(row.firstElementChild!.textContent).toContain('hello-app')
  })

  it('keeps the icons from shrinking so a narrow rail truncates the selector instead', () => {
    useStore.setState({ repo: demo.id, repos: [demo] })
    const el = renderRail()
    const add = addButton(el)!
    expect(add.className).toContain('shrink-0')
    expect(el.querySelector('button[aria-label^="Show "]')!.className).toContain('shrink-0')
    const picker = add.parentElement!.firstElementChild!
    expect(picker.className).toContain('min-w-0')
    expect(picker.className).toContain('flex-1')
  })

  it('leaves the "Add folder…" item in the menu', () => {
    const el = renderRail()
    act(() => el.querySelector('button')!.click())
    const item = [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Add folder…'
    )
    expect(item).toBeDefined()
    act(() => item!.click())
    expect(useStore.getState().addFolderOpen).toBe(true)
  })
})
