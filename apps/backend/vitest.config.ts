import { defineConfig } from 'vitest/config';
import path from 'path';


// The rules for our exam
export default defineConfig({
  test: {
    // Don't import describe, it and expect every time
    globals: true,
    environment: 'node',
    // run this before startup
    setupFiles: ['./tests/setup.ts'],
    env: {
      // We create separate env var for testing to avoid errors
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      // reply in these formats
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/dist/',
      ],
    },
    // Run tests in sequence to avoid database conflicts
    sequence: {
      concurrent: false,
    },
  },
  // the import paths of ./src are replaced with @/
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});