import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Build-time version + git fingerprint, injected via Vite's `define`.
// `__APP_VERSION__` reads from package.json — bump that to bump the
// user-visible version. `__GIT_COMMIT__` is the short SHA of the build's
// HEAD; on Vercel this is the SHA of the deployment, locally it's the
// working tree's HEAD. `__BUILD_DATE__` is the ISO timestamp of build.
//
// Wrapped in try/catch so a `git`-less environment (e.g. a Docker
// container without git) still builds; falls back to 'dev'.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))
let gitCommit = 'dev'
try {
  // Vercel sets VERCEL_GIT_COMMIT_SHA — prefer it on production builds
  // since the local-shell `git` may not match the deployed commit.
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    gitCommit = process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  } else {
    gitCommit = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim()
  }
} catch {
  // git not available or not a repo — leave as 'dev'
}
const buildDate = new Date().toISOString()

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_COMMIT__:  JSON.stringify(gitCommit),
    __BUILD_DATE__:  JSON.stringify(buildDate),
  },
  server: {
    proxy: {
      // Forward /api/gss/* to the Grand Slam Systems API during local dev.
      // In production, Vercel's api/gss/[...path].js handler serves this.
      '/api/gss': {
        target: 'https://app.grandslamsystems.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gss/, '/api'),
      },
    },
  },
})
