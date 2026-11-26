import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { browserApi } from '@/lib/api/browser';
import { serverApi } from '@/lib/api/server';
import { getCurrentUser } from '@/lib/auth/session';

import {
  getOwnPracticeHistoryFirstPage,
  getPracticeHistoryFirstPage,
} from './practice-history/practice-history-first-page';
import { saveSectionVisibility } from './profile-visibility-query';
import {
  getOwnFavoritesPage,
  getOwnPublicProfileSummary,
  getPublicFavoritesPage,
} from './queries';
import { viewerOwnsProfile } from './viewer-owns-profile';

vi.mock('next/cache', () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server', () => ({ serverApi: vi.fn() }));
vi.mock('@/lib/api/browser', () => ({ browserApi: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getCurrentUser: vi.fn() }));

const mockServerApi = vi.mocked(serverApi);
const mockBrowserApi = vi.mocked(browserApi);
const mockGetCurrentUser = vi.mocked(getCurrentUser);

const notFound = () =>
  new ApiError({
    statusCode: 404,
    code: 'NOT_FOUND',
    message: 'Section not found',
  });

describe('a section the owner hid, read for visitors', () => {
  beforeEach(() => {
    mockServerApi.mockReset();
  });

  it('answers null for the favorites of a hidden section', async () => {
    mockServerApi.mockRejectedValueOnce(notFound());

    await expect(getPublicFavoritesPage('ada_lovelace')).resolves.toBeNull();
  });

  it('answers null for the practice history of a hidden section', async () => {
    mockServerApi.mockRejectedValueOnce(notFound());

    await expect(
      getPracticeHistoryFirstPage('ada_lovelace'),
    ).resolves.toBeNull();
  });

  it('lets a failure other than NOT_FOUND through the favorites read', async () => {
    const failure = new Error('connection refused');
    mockServerApi.mockRejectedValueOnce(failure);

    await expect(getPublicFavoritesPage('ada_lovelace')).rejects.toBe(failure);
  });
});

describe('a section read as its owner', () => {
  beforeEach(() => {
    mockServerApi.mockReset();
  });

  it('forwards the request cookies so the API sees the owner', async () => {
    mockServerApi.mockResolvedValueOnce({ items: [], nextCursor: null });

    await getOwnFavoritesPage('ada_lovelace');

    expect(mockServerApi).toHaveBeenCalledWith(
      '/users/ada_lovelace/favorites',
      expect.objectContaining({ forwardCookies: true }),
    );
  });

  it('forwards the request cookies for the Summary numbers', async () => {
    mockServerApi.mockResolvedValueOnce({
      streakDays: 0,
      sungCount: 0,
      favoritesCount: 0,
      contributionsCount: 0,
    });

    await getOwnPublicProfileSummary('ada_lovelace');

    expect(mockServerApi).toHaveBeenCalledWith(
      '/users/ada_lovelace/summary',
      expect.objectContaining({ forwardCookies: true }),
    );
  });

  it('forwards the request cookies and includes private runs in the owner history', async () => {
    mockServerApi.mockResolvedValueOnce({ items: [], nextCursor: null });

    await getOwnPracticeHistoryFirstPage('ada_lovelace');

    expect(mockServerApi).toHaveBeenCalledWith(
      '/users/ada_lovelace/attempts',
      expect.objectContaining({
        forwardCookies: true,
        query: expect.objectContaining({ includePrivate: true }),
      }),
    );
  });

  it('answers null when even the owner cannot read the section', async () => {
    mockServerApi.mockRejectedValueOnce(notFound());

    await expect(getOwnFavoritesPage('ada_lovelace')).resolves.toBeNull();
  });
});

describe('viewerOwnsProfile', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset();
  });

  it('is true for the signed-in User of that username', async () => {
    mockGetCurrentUser.mockResolvedValueOnce({
      username: 'ada_lovelace',
    } as Awaited<ReturnType<typeof getCurrentUser>>);

    await expect(viewerOwnsProfile('ada_lovelace')).resolves.toBe(true);
  });

  it('is false for another User, and for a visitor', async () => {
    mockGetCurrentUser.mockResolvedValueOnce({
      username: 'grace_hopper',
    } as Awaited<ReturnType<typeof getCurrentUser>>);
    await expect(viewerOwnsProfile('ada_lovelace')).resolves.toBe(false);

    mockGetCurrentUser.mockResolvedValueOnce(null);
    await expect(viewerOwnsProfile('ada_lovelace')).resolves.toBe(false);
  });
});

describe('saveSectionVisibility', () => {
  beforeEach(() => {
    mockBrowserApi.mockReset();
  });

  it('patches only the section it names', async () => {
    mockBrowserApi.mockResolvedValueOnce({
      summary: true,
      practiceHistory: true,
      favorites: false,
    });

    await saveSectionVisibility('favorites', false);

    expect(mockBrowserApi).toHaveBeenCalledWith(
      '/me/profile-visibility',
      expect.objectContaining({
        method: 'PATCH',
        body: { favorites: false },
      }),
    );
  });
});
