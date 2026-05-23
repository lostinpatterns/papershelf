/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */
export default {
  '*.ts': ['pnpm lint:fix --max-warnings 0', 'pnpm format:fix'],
  '*.{json,md}': ['pnpm format:fix'],
};
