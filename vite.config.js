import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development, Vite (port 5173) forwards every /api request to the Express server (port 3001).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } },
})
