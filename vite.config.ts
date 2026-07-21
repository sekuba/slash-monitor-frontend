import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = normalizeBasePath(env.VITE_BASE_PATH ?? '/')
  const devApiProxyTarget = command === 'serve'
    ? normalizeOptionalHttpOrigin(env.SLASHMON_DEV_API_PROXY_TARGET)
    : undefined

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
      proxy: devApiProxyTarget ? {
        '/api': {
          target: devApiProxyTarget,
          changeOrigin: true,
          configure(proxy) {
            // The browser talks same-origin to Vite. Do not forward localhost's
            // Origin to a backend deliberately pinned to the production PWA.
            proxy.on('proxyReq', (proxyRequest) => {
              proxyRequest.removeHeader('origin')
            })
          },
        },
      } : undefined,
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

function normalizeOptionalHttpOrigin(value: string | undefined): string | undefined {
  const raw = value?.trim()
  if (!raw) {
    return undefined
  }
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('SLASHMON_DEV_API_PROXY_TARGET must be a credential-free HTTP(S) origin')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SLASHMON_DEV_API_PROXY_TARGET must be an origin without a path, query, or fragment')
  }
  return url.origin
}
