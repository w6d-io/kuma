import { defineConfig } from 'vitest/config';

// The console had no test runner at all, which for the screens that grant permissions is a gap
// rather than a style. jsdom because what is worth testing here reads the browser's own location
// and storage.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
