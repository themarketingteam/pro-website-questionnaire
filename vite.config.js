import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const visualEntryHarnessEnabled = process.env.E2E_PRO_DRAFT_ENTRY_VISUALS === 'true'

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true'
    }),
    react(),
  ],
  build: visualEntryHarnessEnabled ? {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        'pro-draft-entry': resolve(
          process.cwd(),
          'tests/e2e/fixtures/pro-draft-entry.html',
        ),
        'pro-draft-recovery': resolve(
          process.cwd(),
          'tests/e2e/fixtures/pro-draft-recovery.html',
        ),
      },
    },
  } : undefined,
});
