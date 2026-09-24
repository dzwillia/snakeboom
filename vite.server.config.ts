import { defineConfig } from 'vite';

/** Bundles the relay for Node; dependencies stay external (installed in the image). */
export default defineConfig({
  build: {
    ssr: 'src/server/main.ts',
    outDir: 'dist-server',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'index.js' } },
  },
  ssr: { noExternal: [] },
});
