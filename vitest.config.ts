import { configDefaults, defineConfig } from 'vitest/config'

// CommonCircle tests (web/, server/). The old LoanBook tests run with `npm run test:legacy`.
export default defineConfig({
  test: { environment: 'jsdom', include: ['tests/**/*.test.{ts,tsx}'], exclude: [...configDefaults.exclude, 'tests/legacy/**'], testTimeout: 15000 },
  esbuild: { jsx: 'automatic' },
})
