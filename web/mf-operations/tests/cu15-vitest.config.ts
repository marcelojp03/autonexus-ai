import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { pool: 'threads', maxWorkers: 1, testTimeout: 5000, hookTimeout: 5000 } });
