import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface DisclosureProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Minimalist progressive-disclosure dropdown panel.
 * Keeps every tab calm and readable on first glance while preserving full engineering depth one click away.
 */
export function Disclosure({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="sl-card overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
      >
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-zinc-100">{title}</div>
          {subtitle && <div className="mt-0.5 text-[11.5px] text-zinc-500">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          <ChevronDown
            className={`h-4 w-4 text-zinc-400 transition-transform duration-150 ${
              open ? 'rotate-180 text-white' : ''
            }`}
          />
        </div>
      </button>

      {open && (
        <div className="border-t border-white/[0.07] px-4 py-3.5">{children}</div>
      )}
    </section>
  );
}
