import Link from "next/link";
import SymbolSearch from "@/components/SymbolSearch";
import SetupNotice from "@/components/SetupNotice";
import ThemeToggle from "@/components/ThemeToggle";

export default function NavBar({ search = true }: { search?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-fg shadow-[0_0_18px_-4px_var(--glow)]">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l5-6 4 4 8-9" />
              <path d="M15 6h5v5" />
            </svg>
          </span>
          <span className="hidden text-base font-semibold tracking-tight text-fg sm:inline">
            Tick<span className="text-accent-text">why</span>
          </span>
        </Link>
        <nav className="ml-2 hidden items-center gap-1 text-sm md:flex">
          <Link href="/#markets" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            Markets
          </Link>
        </nav>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          {search && (
            <div className="w-full max-w-sm">
              <SymbolSearch compact placeholder="Search stocks & indexes…" />
            </div>
          )}
          <ThemeToggle />
        </div>
      </div>
      <SetupNotice />
    </header>
  );
}
