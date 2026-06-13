// The JSX Source Stamp adds data-pointcut-loc to the lowercase host elements
// below (<main>, <h1>, <button>, ...). The <Card> component usage is skipped —
// a click on its rendered output resolves to the nearest stamped host inside it.
const items = ['one', 'two', 'three'];

function Card({ children }) {
  return <section className="card">{children}</section>;
}

export default function App() {
  return (
    <main className="page">
      <h1 className="title">Pointcut tracer bullet</h1>
      <p className="lede">
        Click <strong>pick</strong> (bottom-right), then click any element below.
        Your editor opens at that element's exact spot in this file.
      </p>
      <Card>
        <h2>A card</h2>
        <button className="cta">Primary action</button>
        <button className="cta ghost">Secondary</button>
      </Card>
      <ul className="list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </main>
  );
}
