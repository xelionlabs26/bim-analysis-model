import { defineConfig, type Plugin } from 'vite';

/**
 * `--mode artifact` builds the claude.ai-hosted page: three.js is left
 * external (loaded from jsDelivr through an import map) and the bundled
 * @fontsource faces are dropped in favour of a Google Fonts stylesheet.
 * scripts/make-artifact.mjs then inlines the result into one page.
 */
function artifactMode(): Plugin {
  const STUB = '\0fontsource-stub';
  return {
    name: 'pagoda-artifact',
    enforce: 'pre',
    resolveId: (id) => (id.startsWith('@fontsource/') ? STUB : null),
    load: (id) => (id === STUB ? 'export {};' : null),
  };
}

export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    base: './',
    plugins: artifact ? [artifactMode()] : [],
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1200,
      outDir: artifact ? 'dist-artifact' : 'dist',
      emptyOutDir: true,
      ...(artifact ? { modulePreload: { polyfill: false }, rollupOptions: { external: ['three', /^three\//] } } : {}),
    },
    test: { environment: 'node' },
  } as any;
});
