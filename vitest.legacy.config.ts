import { defineConfig } from 'vitest/config'

// Historical LoanBook (Arc/EVM) tests for src/. Not part of CommonCircle.
export default defineConfig({ test: { environment: 'jsdom', include: ['tests/legacy/**/*.test.{ts,tsx}'], testTimeout: 15000 }, esbuild: { jsx: 'automatic' } })
