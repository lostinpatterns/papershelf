import { defineConfig, type ViteUserConfig } from 'vitest/config';

const config: ViteUserConfig = defineConfig({
  test: {
    environment: 'node',
    include: ['evals/**/*.eval.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['vitest-evals/reporter'],
    env: {
      VITEST_EVALS_REPLAY_MODE: process.env['VITEST_EVALS_REPLAY_MODE'] ?? 'strict',
      VITEST_EVALS_REPLAY_DIR: '.vitest-evals/recordings',
    },
  },
});

export default config;
