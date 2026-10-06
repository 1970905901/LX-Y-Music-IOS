const baseRule = {
  'no-new': 'off',
  camelcase: 'off',
  'no-return-assign': 'off',
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'space-before-function-paren': ['error', 'never'],
  'no-var': 'error',
  'no-fallthrough': 'off',
  eqeqeq: 'off',
  'require-atomic-updates': 'off',
  'no-void': ['error', { allowAsStatement: true }],
  'no-multiple-empty-lines': [1, { max: 2 }],
  'comma-dangle': [2, 'always-multiline'],
  'standard/no-callback-literal': 'off',
  'prefer-const': 'off',
  'no-labels': 'off',
  'node/no-callback-literal': 'off',
  'multiline-ternary': 'off',
  'react/display-name': 'off',
  'react/prop-types': 'off',
  // import 顺序：只强制「分组顺序」，不强制字母序、不强制空行。
  // 先以 warn 引入：本仓现存写法是相对导入与 @/ 别名交替（如
  // Home/Vertical/Main.tsx 的 ../Views/* 排在 @/store/* 之前），一次改成 error
  // 会产生大量需要人工确认的排序 diff。warn 不阻断 CI，可分批 --fix 收敛。
  // 副作用导入（import 'x'）不参与排序，避免打乱 polyfill / shim 的先后依赖。
  'import/order': [
    'warn',
    {
      groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object'],
      pathGroups: [{ pattern: '@/**', group: 'internal', position: 'after' }],
      pathGroupsExcludedImportTypes: ['builtin'],
      'newlines-between': 'ignore',
      warnOnUnassignedImports: false,
    },
  ],
}

module.exports = {
  root: true,
  extends: [
    'standard',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:react/jsx-runtime',
  ],
  plugins: [
    'react',
    'import',
  ],
  rules: baseRule,
  parser: '@babel/eslint-parser',
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      extends: ['standard-with-typescript'],
      rules: {
        ...baseRule,
        '@typescript-eslint/strict-boolean-expressions': 'off',
        'no-unused-vars': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/space-before-function-paren': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/restrict-template-expressions': [
          1,
          {
            allowBoolean: true,
          },
        ],
        '@typescript-eslint/no-misused-promises': [
          'error',
          {
            checksVoidReturn: {
              arguments: false,
              attributes: false,
            },
          },
        ],
        '@typescript-eslint/naming-convention': 'off',
        '@typescript-eslint/return-await': 'off',
        '@typescript-eslint/comma-dangle': 'off',
        '@typescript-eslint/no-dynamic-delete': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/prefer-nullish-coalescing': 'off',
        '@typescript-eslint/method-signature-style': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
        'require-atomic-updates': 'off',
        '@typescript-eslint/consistent-type-assertions': [
          'error',
          {
            assertionStyle: 'as',
            objectLiteralTypeAssertions: 'allow',
          },
        ],
      },
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    {
      files: ['*.d.ts'],
      rules: {
        'no-var': 'off',
      },
    },
  ],
  settings: {
    react: {
      version: 'detect', // React version. "detect" automatically picks the version you have installed.
      // You can also use `16.0`, `16.3`, etc, if you want to override the detected value.
      // It will default to "latest" and warn if missing, and to "detect" in the future
    },
  },
  ignorePatterns: [
    'node_modules',
    '*.min.js',
    'test.js',
    '*Test.ts',
  ],
}
