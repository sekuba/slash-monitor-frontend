import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Plugin to copy index.html to 404.html for GitHub Pages SPA routing
function copyIndexTo404() {
  return {
    name: 'copy-index-to-404',
    closeBundle() {
      const distPath = path.resolve(__dirname, 'dist')
      const indexPath = path.join(distPath, 'index.html')
      const notFoundPath = path.join(distPath, '404.html')

      if (fs.existsSync(indexPath)) {
        fs.copyFileSync(indexPath, notFoundPath)
        console.log('✓ Copied index.html to 404.html for GitHub Pages')
      }
    }
  }
}

export default defineConfig({
  plugins: [react(), copyIndexTo404()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: '/',
  server: {
    port: 5173,
  },
})
