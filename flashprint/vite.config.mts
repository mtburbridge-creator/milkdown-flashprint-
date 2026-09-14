import vueJsx from '@vitejs/plugin-vue-jsx'
import { defineConfig } from 'vite'

// The app lives behind markburbridge.com/FlashPrint, reverse-proxied to the
// Vercel deployment. Vercel serves static files by path, so the build must
// physically land under dist/FlashPrint and every asset URL must start with
// /FlashPrint/. The GitHub Pages workflow overrides both variables, because
// Pages serves the app under the repository name from the top of dist.
const base = process.env.FLASHPRINT_BASE ?? '/FlashPrint/'
const outDir = process.env.FLASHPRINT_OUT_DIR ?? 'dist/FlashPrint'

export default defineConfig({
  base,
  plugins: [vueJsx()],
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: false,
    },
  },
})
