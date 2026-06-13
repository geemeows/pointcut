import { createApp } from 'vue';
// The pretend third-party UI kit is linked from node_modules in index.html (a
// real <link href> so the stylesheet keeps a node_modules href in dev — that is
// the signal the provenance walker flags as vendor-owned, issue #6).
import App from './App.vue';

createApp(App).mount('#app');
