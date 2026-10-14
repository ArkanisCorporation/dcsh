// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // '.ci' and 'artifacts' are injected into the workspace by the shared CI reusable workflows; not ours to lint.
  { ignores: ['dist', 'node_modules', '.ci', 'artifacts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
