import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const caminhos = (...camadas) => camadas.flatMap((c) => [`**/${c}`, `**/${c}/**`, `@modules/*/${c}`, `@modules/*/${c}/**`])
const CAMADAS_PROIBIDAS = {
  domain: caminhos('application', 'infrastructure', 'presentation'),
  application: caminhos('infrastructure', 'presentation'),
  presentation: caminhos('infrastructure'),
}

function fronteira(arquivos, camada, patterns) {
  return {
    files: [arquivos],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: patterns,
              message: `Fronteira de arquitetura (${camada}): import proibido nesta camada. Ver docs/plano-arquitetura-organizacao.md.`,
            },
          ],
        },
      ],
    },
  }
}

export default tseslint.config(
  { ignores: ['dist', 'dist-fixture', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  // Fronteiras de arquitetura (Fase 0: warn). Um bloco por camada: regra repetida no mesmo arquivo substitui, não soma.
  fronteira('src/modules/*/domain/**', 'domain', [
    ...['react', 'react-dom', 'react-router*', '@tanstack/*', '@supabase/*', 'idb', 'three', 'pdfjs-dist'],
    ...CAMADAS_PROIBIDAS.domain,
  ]),
  fronteira('src/modules/*/application/**', 'application', [
    ...['react', 'react-dom', 'react-router*', '@supabase/*'],
    ...CAMADAS_PROIBIDAS.application,
  ]),
  fronteira('src/modules/*/presentation/**', 'presentation', CAMADAS_PROIBIDAS.presentation),
  fronteira('src/shared/kernel/**', 'shared/kernel', [
    ...['react', 'react-dom', 'react-router*', '@supabase/*', 'idb', 'three', 'pdfjs-dist'],
  ]),
  fronteira('src/apps/miniapp/**', 'apps/miniapp', ['@apps/admin', '@apps/admin/**', '**/apps/admin/**']),
  fronteira('src/apps/admin/**', 'apps/admin', ['@apps/miniapp', '@apps/miniapp/**', '**/apps/miniapp/**']),
  {
    // Funções da Vercel e código do gerador do boletim: Node, fora do bundle do Vite.
    files: ['api/**/*.ts', 'servidor/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
)
