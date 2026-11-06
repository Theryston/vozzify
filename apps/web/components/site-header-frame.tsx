'use client';

import { type ReactNode, useRef } from 'react';

import { useHideOnScroll } from '@/hooks/use-hide-on-scroll';

/**
 * The sticky part of the site header: slides away while scrolling down and
 * comes back on scroll up (or when anything in it gets keyboard focus).
 */
export function SiteHeaderFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const hidden = useHideOnScroll(ref);

  return (
    <header
      ref={ref}
      data-hidden={hidden || undefined}
      className="sticky top-0 z-40 pt-2 transition-transform duration-300 ease-out-soft focus-within:translate-y-0 data-hidden:-translate-y-full md:pt-3"
    >
      {children}
    </header>
  );
}
