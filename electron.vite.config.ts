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
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
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
    // a plain single entry: unknown paths stay 404 (no SPA fallback needed;
    // the renderer talks to the core over IPC only, Fase 3)
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
