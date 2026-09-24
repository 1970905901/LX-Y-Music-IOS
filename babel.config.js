module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    {
      visitor: {
        ImportDeclaration(path) {
          if (path.node.source.value === 'react/jsx-runtime') {
            path.node.source.value = '@/utils/jsxRuntimeProbe'
          }
        },
      },
    },
    '@babel/plugin-proposal-export-namespace-from',
    [
      'module-resolver',
      {
        root: ['.'],
        extensions: [
          '.android.ts',
          '.ios.ts',
          '.android.tsx',
          '.ios.tsx',
          '.tsx',
          '.ts',
          '.android.js',
          '.ios.js',
          '.android.jsx',
          '.ios.jsx',
          '.jsx',
          '.js',
          '.json',
        ],
        alias: {
          '@': './src',
          // '@config': './src/config',
          // '@store': './src/store',
          // '@components': './src/components',
          // '@navigation': './src/navigation',
          // '@screens': './src/screens',
          // '@theme': './src/theme',
        },
      },
    ],
  ],
}
