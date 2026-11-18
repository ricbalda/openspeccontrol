import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    build: {
      // bundle everything: a sandboxed preload cannot load external deps
      externalizeDeps: false,
      rolldownOptions: {
        output: {
          // a sandboxed preload cannot be ESM; force CJS (out/preload/index.cjs)
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    // 'mpa' disables vite's SPA fallback: in dev the renderer still fetches
    // /api/* (its transport arrives in Fase 3) and the fallback would answer
    // those calls with a 200 + index.html, poisoning the store with undefined
    // keys and crashing the panes. With 'mpa' they fail as 404s instead.
    appType: 'mpa',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    base: './',
    // WSL: inotify doesn't fire reliably on Windows drives (/mnt/c), so poll there
    server: process.cwd().startsWith('/mnt/')
      ? { watch: { usePolling: true, interval: 300 } }
      : undefined
  }
})
