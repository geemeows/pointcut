// The demo UI. Lowercase host tags below get stamped with data-pointcut-loc by
// the Pointcut JSX Source Stamp (it runs before esbuild's JSX transform). A
// click on any of them in the running page resolves to its exact line here.
import { h, Fragment } from './h.js';

function Card({ children }) {
  // <Card> is a component, so it is NOT stamped; a click on its rendered output
  // resolves to the nearest stamped host (the <section> below) — usage site,
  // not internals.
  return <section class="card">{children}</section>;
}

export default function App() {
  return (
    <main class="page">
      <h1 class="title">Pointcut esbuild + Sidecar demo</h1>
      <p class="lede">
        No dev-server middleware here — esbuild just bundles static files. The
        Bridge runs in a separate process via <code>npx pointcut-sidecar</code>,
        and the client reaches it cross-origin at the stamped base URL.
      </p>
      <Card>
        <h2>A card</h2>
        <button class="cta">Primary action</button>
        <button class="cta ghost">Secondary</button>
      </Card>
      <ul class="list">
        <li>First item</li>
        <li>Second item</li>
        <li>Third item</li>
      </ul>
    </main>
  );
}
