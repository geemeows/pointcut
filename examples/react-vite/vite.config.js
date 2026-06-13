import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pointcut from '@pointcut/unplugin/vite';

// The user opts Pointcut in behind their own dev condition (lock #1); the
// plugin's `apply: 'serve'` refuses to run in a production build (lock #2).
// `enforce: 'pre'` ensures the JSX Source Stamp runs before plugin-react's
// own JSX transform, so the stamped line:col matches the real source.
// Run with DESIGN=1 to enable: `DESIGN=1 pnpm --filter @pointcut/example-react-vite dev`.
export default defineConfig({
  plugins: [
    process.env.DESIGN ? pointcut({ framework: 'jsx' }) : null,
    react(),
  ].filter(Boolean),
});
