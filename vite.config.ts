import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base works for GitHub Pages at https://<login>.github.io/<repo>/
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
    __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'local'),
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts', 'tests/dom/**/*.test.ts'],
  },
});
