// @vitest-environment happy-dom

import { NextIntlClientProvider } from 'next-intl';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en.json';
import { CarouselScroller } from './carousel-scroller';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Cards({ carouselCopy }: { carouselCopy?: string }) {
  return Array.from({ length: 6 }, (_, index) =>
    createElement(
      'li',
      {
        key: index,
        'data-home-item-id': `track-${index}`,
        'data-carousel-copy': carouselCopy,
        'aria-hidden':
          carouselCopy && carouselCopy !== 'middle' ? true : undefined,
      },
      createElement('a', { href: `/tracks/${index}` }, `Track ${index}`),
    ),
  );
}

let viewportWidth = 400;
const resizeCallbacks = new Set<() => void>();

beforeEach(() => {
  viewportWidth = 400;
  resizeCallbacks.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly callback: () => void;
      observe = vi.fn();
      constructor(callback: () => void) {
        this.callback = callback;
        resizeCallbacks.add(callback);
      }
      disconnect() {
        resizeCallbacks.delete(this.callback);
      }
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.tagName === 'UL' ? viewportWidth : 100;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.tagName === 'UL' ? this.children.length * 100 : 100;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const parent = this.parentElement;
      const left =
        this.tagName === 'LI' && parent
          ? Array.from(parent.children).indexOf(this) * 100 - parent.scrollLeft
          : 0;
      const width = this.tagName === 'UL' ? viewportWidth : 100;
      return {
        left,
        right: left + width,
        top: 0,
        bottom: 100,
        width,
        height: 100,
        x: left,
        y: 0,
        toJSON: () => ({}),
      };
    },
  );
});

afterEach(() => {
  document.body.replaceChildren();
});

async function renderCarousel(exhausted = true) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (complete: boolean) => {
    await act(async () => {
      root.render(
        createElement(NextIntlClientProvider, {
          locale: 'en',
          timeZone: 'UTC',
          messages,
          // biome-ignore lint/correctness/noChildrenProp: this test uses createElement instead of JSX.
          children: createElement(CarouselScroller, {
            header: 'Tracks',
            exhausted: complete,
            // biome-ignore lint/correctness/noChildrenProp: this test uses createElement instead of JSX.
            children: createElement(Cards),
          }),
        }),
      );
    });
  };
  await render(exhausted);
  const track = container.querySelector('ul');
  if (!track) throw new Error('Carousel did not render');
  const links = () => [
    ...track.querySelectorAll<HTMLAnchorElement>('li:not([aria-hidden]) a'),
  ];
  const key = async (keyName: string) => {
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: keyName, bubbles: true }),
      );
    });
  };
  const scroll = async (left: number) => {
    await act(async () => {
      track.scrollLeft = left;
      track.dispatchEvent(new Event('scroll'));
    });
  };
  return {
    track,
    links,
    key,
    render,
    scroll,
    resize: async (width: number) => {
      await act(async () => {
        viewportWidth = width;
        for (const callback of resizeCallbacks) callback();
      });
    },
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe('circular Home carousel interaction', () => {
  it('waits for exhaustion, keeps fitting rows finite and resets the copies', async () => {
    const carousel = await renderCarousel(false);
    try {
      expect(carousel.track.children).toHaveLength(6);
      await carousel.render(true);
      expect(carousel.track.children).toHaveLength(18);
      expect(carousel.track.scrollLeft).toBe(600);
      expect(carousel.links()).toHaveLength(6);
      expect(
        [...carousel.track.querySelectorAll('li[aria-hidden] a')].map(
          (link) => (link as HTMLAnchorElement).tabIndex,
        ),
      ).toEqual(Array.from({ length: 12 }, () => -1));
      await carousel.render(false);
      expect(carousel.track.children).toHaveLength(6);
      expect(carousel.links().every((link) => link.tabIndex === 0)).toBe(true);
    } finally {
      await carousel.close();
    }
    viewportWidth = 800;
    const fitting = await renderCarousel();
    expect(fitting.track.children).toHaveLength(6);
    await fitting.close();
  });

  it('wraps keyboard focus in both directions without adding tab stops', async () => {
    const carousel = await renderCarousel();
    try {
      carousel.links()[0]?.focus();
      await carousel.key('ArrowLeft');
      expect(document.activeElement?.textContent).toBe('Track 5');
      expect(document.activeElement?.closest('li')?.dataset.carouselCopy).toBe(
        'middle',
      );
      await carousel.key('ArrowRight');
      expect(document.activeElement?.textContent).toBe('Track 0');
      await carousel.key('ArrowRight');
      expect(document.activeElement?.textContent).toBe('Track 1');
      await carousel.key('Tab');
      expect(document.activeElement?.textContent).toBe('Track 1');
      expect(carousel.links()).toHaveLength(6);
    } finally {
      await carousel.close();
    }
  });

  it('recenters repeatedly with bounded contents and keeps focused Tracks accessible', async () => {
    const carousel = await renderCarousel();
    try {
      carousel.links()[2]?.focus();
      await carousel.scroll(1300);
      expect(carousel.track.scrollLeft).toBe(700);
      expect(document.activeElement?.textContent).toBe('Track 2');
      expect(document.activeElement?.closest('li')?.dataset.carouselCopy).toBe(
        'middle',
      );
      await carousel.key('ArrowRight');
      expect(document.activeElement?.textContent).toBe('Track 3');
      await carousel.scroll(100);
      expect(carousel.track.scrollLeft).toBe(700);
      expect(carousel.track.children).toHaveLength(18);
      expect(carousel.links()).toHaveLength(6);
    } finally {
      await carousel.close();
    }
  });

  it('moves a presentation-copy interaction to its logical accessible Track', async () => {
    const carousel = await renderCarousel();
    try {
      const copy = carousel.track.querySelector<HTMLAnchorElement>(
        'li[data-carousel-copy="after"] a',
      );
      if (!copy) throw new Error('Presentation copy did not render');
      await act(async () => {
        copy.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        copy.focus();
      });
      await act(async () => {
        copy.dispatchEvent(new Event('pointerup', { bubbles: true }));
        copy.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(document.activeElement?.textContent).toBe('Track 0');
      expect(document.activeElement?.closest('li')?.dataset.carouselCopy).toBe(
        'middle',
      );
      expect(carousel.links()).toHaveLength(6);
    } finally {
      await carousel.close();
    }
  });

  it('restores a middle segment when looping is enabled again after being finite', async () => {
    const carousel = await renderCarousel();
    try {
      carousel.links()[0]?.focus();
      await carousel.key('ArrowLeft');
      await carousel.render(false);
      await carousel.scroll(0);
      await carousel.render(true);
      expect(carousel.track.scrollLeft).toBe(600);
      expect(
        carousel.track.children[6]?.getAttribute('data-carousel-copy'),
      ).toBe('middle');
    } finally {
      await carousel.close();
    }
  });

  it('preserves the focused Track when the last page enables looping and a resize removes it', async () => {
    const carousel = await renderCarousel(false);
    try {
      carousel.links()[2]?.focus();
      await carousel.render(true);
      expect(document.activeElement?.textContent).toBe('Track 2');
      expect(document.activeElement?.closest('li')?.dataset.carouselCopy).toBe(
        'middle',
      );
      carousel.links()[0]?.focus();
      await carousel.key('ArrowLeft');
      expect(document.activeElement?.textContent).toBe('Track 5');
      await carousel.resize(800);
      expect(carousel.track.children).toHaveLength(6);
      expect(document.activeElement?.textContent).toBe('Track 5');
      expect(document.activeElement?.closest('li')?.dataset.carouselCopy).toBe(
        undefined,
      );
      await carousel.resize(400);
      expect(carousel.track.children).toHaveLength(18);
      expect(document.activeElement?.textContent).toBe('Track 5');
    } finally {
      await carousel.close();
    }
  });

  it('does not restore a Track after focus moved outside or was explicitly blurred', async () => {
    const carousel = await renderCarousel(false);
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      carousel.links()[2]?.focus();
      outside.focus();
      await carousel.render(true);
      expect(document.activeElement).toBe(outside);
      carousel.links()[3]?.focus();
      carousel.links()[3]?.blur();
      await carousel.resize(800);
      expect(document.activeElement).toBe(document.body);
      await carousel.resize(400);
      carousel.links()[4]?.focus();
      outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      await carousel.resize(800);
      expect(document.activeElement).toBe(document.body);
    } finally {
      await carousel.close();
      outside.remove();
    }
  });
});
