import vueJsx from '@vitejs/plugin-vue-jsx'
import { defineConfig } from 'vite'

// GitHub Pages serves the app under the repository name. The deploy
// workflow sets FLASHPRINT_BASE to that path.
export default defineConfig({
  base: process.env.FLASHPRINT_BASE ?? '/',
  plugins: [vueJsx()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: false,
    },
  },
})
