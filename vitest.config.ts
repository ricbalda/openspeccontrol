import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))
const r = (p: string): string => path.join(root, p)

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('src/shared'),
      '@renderer': r('src/renderer/src')
    }
  },
  test: {
    projects: [
      {
        test: {
          name: 'main',
          include: ['test/main/**/*.test.ts'],
          environment: 'node',
          // default data dir for tests that do not create their own (each test
          // file runs in its own worker, like the server tests of Studio did)
          env: {
            OSC_DATA: path.join(os.tmpdir(), 'openspeccontrol-test')
          }
        }
      },
      {
        test: {
          name: 'renderer',
          include: ['test/renderer/**/*.test.{ts,tsx}'],
          // jsdom is enabled per file with `// @vitest-environment jsdom`
          environment: 'node'
        }
      }
    ]
  }
})
