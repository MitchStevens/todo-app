/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Relative paths, so the built app works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [preact()],
  test: {
    environment: 'node',
  },
});
