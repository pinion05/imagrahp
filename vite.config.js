import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        changelog: path.resolve(__dirname, 'changelog.html')
      }
    }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:7837'
    }
  }
})
