import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = normalizeBasePath(env.VITE_BASE_PATH ?? '/')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    base,
    server: {
      port: 5173,
    },
  }
})

function normalizeBasePath(value: string): string {
  const normalized = `/${value.trim().replace(/^\/+|\/+$/g, '')}/`.replace('//', '/')
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(normalized)) {
    throw new Error('VITE_BASE_PATH must be an absolute URL path such as / or /slashmon/')
  }
  return normalized
}
