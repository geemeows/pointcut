// A 30-line hyperscript so the demo can write JSX without pulling in React.
// esbuild's classic JSX transform turns `<button class="x">y</button>` into
// `h('button', { class: 'x' }, 'y')` (jsxFactory: 'h', jsxFragment: 'Fragment').
// Crucially, the Pointcut JSX Source Stamp runs BEFORE esbuild's JSX transform
// (unplugin `enforce: 'pre'`), so each lowercase host tag already carries a
// `data-pointcut-loc` attribute by the time it becomes an `h(...)` call — and it
// lands on the real DOM node as an attribute below.
export const Fragment = Symbol('Fragment');

export function h(type, props, ...children) {
  const flat = children.flat(Infinity).filter((c) => c != null && c !== false);

  if (type === Fragment) {
    const frag = document.createDocumentFragment();
    flat.forEach((c) => frag.appendChild(toNode(c)));
    return frag;
  }

  const el = document.createElement(type);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value != null) {
      // data-pointcut-loc and every other attribute land on the DOM node here.
      el.setAttribute(key, String(value));
    }
  }
  flat.forEach((c) => el.appendChild(toNode(c)));
  return el;
}

function toNode(child) {
  return child instanceof Node ? child : document.createTextNode(String(child));
}
