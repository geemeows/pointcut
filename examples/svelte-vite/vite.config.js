import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import pointcut from '@pointcut/unplugin/vite';

// The user opts Pointcut in behind their own dev condition (lock #1); the
// plugin's `apply: 'serve'` refuses to run in a production build (lock #2).
// Run with DESIGN=1 to enable: `DESIGN=1 pnpm --filter @pointcut/example-svelte-vite dev`.
export default defineConfig({
  plugins: [
    process.env.DESIGN ? pointcut({ framework: 'svelte' }) : null,
    svelte(),
  ].filter(Boolean),
});
