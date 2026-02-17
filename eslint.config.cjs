const tsParser = require('@typescript-eslint/parser');
const reactRefresh = require('eslint-plugin-react-refresh').default;

module.exports = [
    {
        ignores: ['dist', '.eslintrc.cjs', '.yarn/**'],
    },
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            'react-refresh': reactRefresh,
        },
        rules: {
            'react-refresh/only-export-components': [
                'error',
                { allowConstantExport: true },
            ],
        },
    },
];
