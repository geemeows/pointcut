// Entry. The unplugin auto-injects `import '@pointcut/core/client'` only on the
// dev-server (transformIndexHtml) path; esbuild has no such hook, so for the
// dev-server-less Sidecar setup we import the client ourselves (this is exactly
// the `inject: false` contract). The client reads the build-time-stamped
// __POINTCUT_BRIDGE__ base URL and reaches the Sidecar cross-origin.
import '@pointcut/core/client';
import App from './App.jsx';

document.getElementById('app').appendChild(App());
