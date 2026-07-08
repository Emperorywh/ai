/* eslint-env node */
/**
 * ESLint 配置（legacy eslintrc，配合 ESLint 8）。
 *
 * 项目源码使用 ESM（package.json "type": "module"），
 * 但本配置文件以 .cjs 显式声明为 CommonJS，二者互不影响。
 * lint 脚本限定扫描 src 与 test，根目录配置文件不参与扫描。
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    // 未使用变量视为警告；以 _ 前缀的参数视为有意忽略
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
}
