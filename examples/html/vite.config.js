import { defineConfig } from 'vite';
import pointcut from '@pointcut/unplugin/vite';

// The user opts Pointcut in behind their own dev condition (lock #1); the
// plugin's `apply: 'serve'` refuses to run in a production build (lock #2).
// Run with DESIGN=1 to enable: `DESIGN=1 pnpm --filter @pointcut/example-html dev`.
//
// framework:'html' routes the shared transform() through the HTML Stamper, which
// stamps data-pointcut-loc onto this page's opening element tags. The Vite glue
// separately injects the client via transformIndexHtml — the two don't collide.
export default defineConfig({
  plugins: [process.env.DESIGN ? pointcut({ framework: 'html' }) : null].filter(Boolean),
});
