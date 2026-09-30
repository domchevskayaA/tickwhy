import Link from "next/link";
import MarketTiles from "@/components/MarketTiles";
import NavBar from "@/components/NavBar";
import SymbolSearch from "@/components/SymbolSearch";

const EXAMPLES = ["NVDA", "TSLA", "AAPL", "META", "XOM", "JPM", "LLY", "NFLX"];

const STEPS = [
  {
    title: "Spot the unusual days",
    body: "Every day the price moved at least twice its usual swing is flagged on the chart.",
  },
  {
    title: "Split the move",
    body: "See how much came from the whole market, the sector, and the company itself.",
  },
  {
    title: "Read the why",
    body: "An AI agent matches each move with the news and earnings around it, and cites its sources.",
  },
];

export default function Home() {
  return (
    <>
      <NavBar search={false} />
      <main className="relative flex-1 overflow-hidden">
        {/* Soft brand glow and grid behind the hero */}
        <div className="pointer-events-none absolute left-1/2 top-[-18rem] h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-accent/15 blur-[120px] dark:bg-accent/10" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />

        <section className="relative mx-auto w-full max-w-3xl px-4 pb-16 pt-20 text-center sm:pt-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--glow)]" />
            Charts · attribution · news, explained by AI
          </span>
          <h1 className="mt-6 text-5xl font-semibold tracking-tight text-fg sm:text-6xl">
            Tick<span className="text-accent-text">why</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted">
            Pick a stock or an index. We flag its unusual price moves, break each one down, and line it up with
            the news that happened at the same time.
          </p>
          <div className="mx-auto mt-10 max-w-xl text-left">
            <SymbolSearch autoFocus />
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((s) => (
              <Link
                key={s}
                href={`/stock/${s}`}
                className="rounded-full border border-border bg-surface/70 px-3 py-1 font-mono text-xs text-muted backdrop-blur transition-colors hover:border-accent hover:text-accent-text"
              >
                {s}
              </Link>
            ))}
          </div>
        </section>

        <section id="markets" className="relative mx-auto w-full max-w-7xl scroll-mt-24 px-4 pb-16">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-text">Markets</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-fg">Major US indexes</h2>
            </div>
            <p className="hidden max-w-sm text-right text-sm text-muted sm:block">
              See which sectors drove the market on any day, and what the news said.
            </p>
          </div>
          <MarketTiles />
        </section>

        <section className="relative mx-auto grid w-full max-w-7xl gap-3 px-4 pb-24 sm:grid-cols-3">
          {STEPS.map((s, n) => (
            <div key={s.title} className="card p-5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft font-mono text-sm font-semibold text-accent-text">
                {n + 1}
              </span>
              <p className="mt-4 font-semibold text-fg">{s.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </section>

        <footer className="relative border-t border-border py-6 text-center text-xs text-subtle">
          For learning about past price moves only — not investment advice.
        </footer>
      </main>
    </>
  );
}
