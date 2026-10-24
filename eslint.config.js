import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/domain/**/*.ts', 'src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'domain/engine не трогают DOM' },
        { name: 'document', message: 'domain/engine не трогают DOM' },
        { name: 'performance', message: 'часы передаются снаружи' },
        { name: 'setTimeout', message: 'часы передаются снаружи' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'rng передаётся снаружи' },
        { object: 'Date', property: 'now', message: 'часы передаются снаружи' },
      ],
    },
  },
  prettier,
);
