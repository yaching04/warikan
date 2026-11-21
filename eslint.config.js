// ESLint の設定（npm run lint）。ビルドはしないので、ブラウザ用とテスト用で分けるだけ。
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'screenshots/**', 'docs/**'] },
  js.configs.recommended,
  {
    files: ['app.js', 'logic.js', 'store.js', 'sync.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: Object.assign({}, globals.browser, { module: 'readonly', WarikanSync: 'readonly' }),
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['sw.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: globals.serviceworker },
  },
  {
    files: ['test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      // page.evaluate の中はブラウザで動くので、アプリのグローバルも許す
      globals: Object.assign({}, globals.node, globals.browser, {
        WarikanStore: 'readonly', WarikanLogic: 'readonly', WarikanSync: 'readonly',
      }),
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-irregular-whitespace': ['error', { skipTemplates: true, skipStrings: true }],
    },
  },
];
