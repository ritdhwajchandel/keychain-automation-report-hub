import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `base` matches the GitHub Pages project path (https://<user>.github.io/<repo>/).
// Locally it resolves to "/" via the dev server default.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/keychain-automation-report-hub/' : '/',
  plugins: [react()],
})
