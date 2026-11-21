import { resolve as resolvePath } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from './tailwind.config'

// Windows: the same folder can arrive as "d:\…" (VS Code) or "D:\…" (Explorer). Rollup keys modules by path string,
// so mixed casing bundled backend/lib/keys.ts twice and the API keys never reached the AI calls. Always use upper case.
const root = __dirname.replace(/^[a-z]:/, (d) => d.toUpperCase())
if (process.cwd().toLowerCase() === root.toLowerCase()) process.chdir(root)
const resolve = (...p: string[]) => resolvePath(root, ...p.slice(1))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          // Fastify backend, launched by main as a separate utility process
          server: resolve(__dirname, 'backend/server.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'electron/preload.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared')
      }
    },
    plugins: [react()],
    css: { postcss: { plugins: [tailwindcss(tailwindConfig), autoprefixer()] } }
  }
})
