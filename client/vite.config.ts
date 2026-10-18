import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { THEME_COLOR } from './src/theme.ts';

/**
 * vite-plugin-pwa 2.0 still passes the Rollup-era `output.inlineDynamicImports` to its service-worker
 * sub-build, which Vite 8 (Rolldown) reports as deprecated. Swap it for the Rolldown equivalent.
 * Remove once the plugin stops setting it.
 */
function swSingleChunk(): Plugin {
  return {
    name: 'sw-single-chunk',
    config(config) {
      const build = config.build as Record<string, any> | undefined;
      for (const key of ['rollupOptions', 'rolldownOptions']) {
        const output = build?.[key]?.output;
        if (output?.inlineDynamicImports) {
          delete output.inlineDynamicImports;
          output.codeSplitting = false;
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Dialysis Centre',
        short_name: 'Dialysis',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: THEME_COLOR,
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        buildPlugins: { vite: [swSingleChunk()] },
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Keep the UI kit out of the app chunk so neither crosses the 500 kB warning limit.
        codeSplitting: { groups: [{ name: 'mantine', test: /node_modules[\\/]@mantine/ }] },
      },
    },
  },
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Node >= 25 ships an experimental global localStorage that shadows jsdom's and warns
    // before any setup file runs, so it can only be switched off with a worker Node flag.
    execArgv: ['--no-experimental-webstorage'],
  },
});
