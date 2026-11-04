// @vitest-environment happy-dom

import type { TrackLyricLine } from '@vozzify/contracts';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KaraokeLine } from './karaoke-line';

const lines: TrackLyricLine[] = [
  {
    start: 1,
    end: 12,
    words: [
      { text: 'Pressure', start: 2, end: 3 },
      { text: 'pushing', start: 3, end: 4 },
      { text: 'down', start: 6, end: 7 },
      { text: 'on', start: 8, end: 9 },
      { text: 'me', start: 9, end: 10 },
    ],
  },
];
let root: Root;
let container: HTMLDivElement;
let width = 160;
let time = 0;
let resized = () => {};
const listeners = new Set<() => void>();
const clock = {
  now: () => time,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, width, 32),
  );
  // happy-dom has no canvas layout; fixed glyph widths give deterministic fits.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
      measureText: (text: string) => ({ width: text.length * 10 }),
    }),
  });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.stubGlobal('getComputedStyle', () => ({
    fontWeight: '600',
    fontSize: '18px',
    fontFamily: 'Arial',
  }));
  width = 160;
  time = 0;
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  expect(listeners.size).toBe(0);
});

async function render(lyrics = lines) {
  await act(async () =>
    root.render(createElement(KaraokeLine, { lines: lyrics, clock })),
  );
}
async function seek(seconds: number) {
  await act(async () => {
    time = seconds;
    for (const listener of listeners) listener();
  });
}

describe('the karaoke single-line slot', () => {
  it('shows one measured segment and changes at the next segment word', async () => {
    await render();
    expect(container.textContent).toBe('Pressure pushing');
    await seek(6);
    expect(container.textContent).toBe('down on me');
    expect(container.querySelector('[data-state="current"]')?.textContent).toBe(
      'down',
    );
    await seek(14.1);
    expect(container.textContent).toBe('');
    expect(container.querySelector('p')?.classList.contains('h-8')).toBe(true);
  });

  it('recalculates segments on fullscreen and viewport changes, including seeking back', async () => {
    await render();
    await seek(8);
    await act(async () => {
      width = 80;
      resized();
    });
    expect(container.textContent).toBe('down on');
    await seek(2);
    expect(container.textContent).toBe('Pressure');
    await act(async () => {
      width = 500;
      resized();
    });
    expect(container.textContent).toBe('Pressure pushing down on me');
  });

  it('fits a single oversized word without truncating it', async () => {
    width = 40;
    await render();
    expect(container.textContent).toBe('Pressure');
    const size = container.querySelector('p > span')?.getAttribute('style');
    expect(size).toContain('font-size:');
    expect(
      container.querySelector('p')?.classList.contains('whitespace-nowrap'),
    ).toBe(true);
  });

  it('measures the slot even when it is initially empty', async () => {
    await render([]);
    await render();
    expect(container.textContent).toBe('Pressure pushing');
  });
});
