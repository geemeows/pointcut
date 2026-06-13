import { createApp } from 'vue';
import App from './App.vue';
// The pretend third-party UI kit is linked from node_modules in index.html (a
// real <link href> served by devServer.static), so the stylesheet keeps a
// node_modules href in dev — the signal the provenance walker flags as
// vendor-owned (issue #6). A JS `import '...css'` would inline a null-href
// <style> via style-loader and defeat the demonstration, so we do NOT import it
// here.

// Auto-attach injects the client into the served page on bundlers with an HTML
// hook (Vite's `transformIndexHtml`). Webpack has no equivalent inject point, so
// the demo imports the client itself, behind the SAME dev lock the plugin uses
// in webpack.config.js. The dynamic import keeps it out of the production bundle.
if (process.env.DESIGN) {
  import('@pointcut/core/client');
}

createApp(App).mount('#app');
