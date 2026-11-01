import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type Mbid,
  type MusicCatalogArtist,
  type MusicCatalogError,
  type MusicCatalogErrorCode,
  type MusicCatalogReleaseGroup,
  type MusicCatalogRequestType,
  type MusicCatalogResponse,
  type MusicCatalogSearchParams,
  type MusicCatalogSearchResult,
  type MusicCatalogTrackAssociationPayload,
  musicCatalogAssociateTrackResponseSchema,
  musicCatalogGetArtistResponseSchema,
  musicCatalogGetRecordingResponseSchema,
  musicCatalogGetReleaseGroupResponseSchema,
  musicCatalogSearchResponseSchema,
  type Recording,
} from '@vozzify/contracts';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import { ENV, type Env } from '../../config/env.js';
import { MusicCatalogConnection } from './music-catalog.connection.js';
import { MUSIC_CATALOG_SEARCH_TIMEOUT_MS } from './music-catalog-socket.js';

/**
 * What the catalog answers for one Recording. `moved` carries the MBID the
 * Recording was merged into, which the caller should follow.
 */
export type CatalogRecordingLookup =
  | { status: 'found'; recording: Recording }
  | { status: 'not-found' }
  | { status: 'moved'; newMbid: Mbid };

/** What the catalog answers for one release group (an Album). */
export type CatalogReleaseGroupLookup =
  | { status: 'found'; releaseGroup: MusicCatalogReleaseGroup }
  | { status: 'not-found' }
  | { status: 'moved'; newMbid: Mbid };

/** What the catalog answers for one artist. */
export type CatalogArtistLookup =
  | { status: 'found'; artist: MusicCatalogArtist }
  | { status: 'not-found' }
  | { status: 'moved'; newMbid: Mbid };

/** The entity each lookup by MBID answers with, by the request that asks for it. */
type CatalogEntities = {
  getRecording: Recording;
  getReleaseGroup: MusicCatalogReleaseGroup;
  getArtist: MusicCatalogArtist;
};

/** The lookups by MBID, named by the protocol's request types. */
export type CatalogLookupType = Extract<
  MusicCatalogRequestType,
  keyof CatalogEntities
>;

/** The answer to a lookup by MBID, whatever the entity is. */
type LookupAnswer<TEntity> =
  | { status: 'found'; entity: TEntity }
  | { status: 'not-found' }
  | { status: 'moved'; newMbid: Mbid };

/**
 * The answer to a lookup of one type: its entity, that the catalog does not know
 * it, or that it was merged into `newMbid`, which the caller follows.
 */
export type CatalogAnswer<TType extends CatalogLookupType> = LookupAnswer<
  CatalogEntities[TType]
>;

/** The entity a lookup of one type finds. */
export type CatalogEntity<TType extends CatalogLookupType> =
  CatalogEntities[TType];

/** The error codes that mean "not known" and "merged" for one entity type. */
type LookupCodes = {
  notFound: MusicCatalogErrorCode;
  moved: MusicCatalogErrorCode;
};

/** How one lookup type is answered: its response schema and its error codes. */
type LookupSpec<TEntity> = {
  schema: z.ZodType<MusicCatalogResponse<TEntity>>;
  codes: LookupCodes;
};

const LOOKUPS: {
  [TType in CatalogLookupType]: LookupSpec<CatalogEntities[TType]>;
} = {
  getRecording: {
    schema: musicCatalogGetRecordingResponseSchema,
    codes: { notFound: 'RECORDING_NOT_FOUND', moved: 'RECORDING_MOVED' },
  },
  getReleaseGroup: {
    schema: musicCatalogGetReleaseGroupResponseSchema,
    codes: {
      notFound: 'RELEASE_GROUP_NOT_FOUND',
      moved: 'RELEASE_GROUP_MOVED',
    },
  },
  getArtist: {
    schema: musicCatalogGetArtistResponseSchema,
    codes: { notFound: 'ARTIST_NOT_FOUND', moved: 'ARTIST_MOVED' },
  },
};

/**
 * The typed operations of the Music catalog, over one persistent connection
 * (`MusicCatalogConnection`). Every answer that is not a result becomes an
 * `AppException`: a dead catalog is `SERVICE_UNAVAILABLE` (retryable) and a
 * slow one `GATEWAY_TIMEOUT`, so the web can retry instead of a dead end.
 */
@Injectable()
export class MusicCatalogClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MusicCatalogClient.name);
  private readonly connection: MusicCatalogConnection;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.connection = new MusicCatalogConnection(env);
  }

  onModuleInit(): void {
    if (!this.isConfigured()) {
      if (this.env.NODE_ENV === 'production') {
        throw new Error(
          'Invalid environment variables:\nMUSIC_CATALOG_URL: Required in production',
        );
      }
      this.logger.warn(
        'Music catalog not configured: search fails until ' +
          'MUSIC_CATALOG_URL and MUSIC_CATALOG_API_KEY are set',
      );
      return;
    }
    this.connection.start();
  }

  onModuleDestroy(): void {
    this.connection.stop();
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  searchRoutingState(): { connected: boolean; generation: number } {
    if (!this.isConfigured()) {
      throw new AppException(
        'INTERNAL_ERROR',
        'Music catalog is not configured',
      );
    }
    const authenticationFailure = this.connection.getAuthenticationFailure();
    if (authenticationFailure !== undefined) {
      throw new AppException(
        'INTERNAL_ERROR',
        `Music catalog authentication failed: ${authenticationFailure}`,
      );
    }
    return {
      connected: this.connection.isConnected(),
      generation: this.connection.getSearchGeneration(),
    };
  }

  onSearchConnectionClosed(listener: () => void): () => void {
    return this.connection.onSearchConnectionClosed(listener);
  }

  /**
   * Searches the catalog, keeping the catalog's relevance order. Every hit
   * is returned untouched; the caller adds the Track link.
   */
  async search(
    params: MusicCatalogSearchParams,
  ): Promise<MusicCatalogSearchResult> {
    if (!this.isConfigured()) {
      throw new AppException(
        'INTERNAL_ERROR',
        'Music catalog is not configured',
      );
    }
    return resultOrThrow(
      await this.connection.requestSearch(
        params,
        musicCatalogSearchResponseSchema,
      ),
    );
  }

  /** Searches only the existing socket; it never starts an on-demand dial. */
  async searchIfConnected(
    params: MusicCatalogSearchParams,
  ): Promise<MusicCatalogSearchResult> {
    if (!this.isConfigured()) {
      throw new AppException(
        'INTERNAL_ERROR',
        'Music catalog is not configured',
      );
    }
    return resultOrThrow(
      await this.connection.requestIfConnected(
        'search',
        params,
        musicCatalogSearchResponseSchema,
        Math.min(
          MUSIC_CATALOG_SEARCH_TIMEOUT_MS,
          this.env.MUSIC_CATALOG_REQUEST_TIMEOUT_MS ??
            MUSIC_CATALOG_SEARCH_TIMEOUT_MS,
        ),
      ),
    );
  }

  /** Persists and projects a Track association in the Music catalog. */
  async associateTrack(
    payload: MusicCatalogTrackAssociationPayload,
  ): Promise<void> {
    resultOrThrow(
      await this.requestOrFail(
        'associateTrack',
        payload,
        musicCatalogAssociateTrackResponseSchema,
      ),
    );
  }

  /**
   * Looks one Recording up by its MBID. A Recording the catalog does not know
   * is `not-found`, and one merged into another Recording is `moved`; both are
   * answers, not failures, so the caller decides what they mean.
   */
  async getRecording(mbid: Mbid): Promise<CatalogRecordingLookup> {
    const answer = await this.lookup('getRecording', mbid);
    return answer.status === 'found'
      ? { status: 'found', recording: answer.entity }
      : answer;
  }

  /**
   * Looks one release group (an Album, ADR 0003) up by its MBID. Its representative
   * release and its tracks come with it; `not-found` and `moved` are answers, as
   * for a Recording.
   */
  async getReleaseGroup(mbid: Mbid): Promise<CatalogReleaseGroupLookup> {
    const answer = await this.lookup('getReleaseGroup', mbid);
    return answer.status === 'found'
      ? { status: 'found', releaseGroup: answer.entity }
      : answer;
  }

  /** Looks one artist up by its MBID: its name and genres. */
  async getArtist(mbid: Mbid): Promise<CatalogArtistLookup> {
    const answer = await this.lookup('getArtist', mbid);
    return answer.status === 'found'
      ? { status: 'found', artist: answer.entity }
      : answer;
  }

  /**
   * One lookup by MBID of the given type: a result is `found`; the type's own
   * codes are `not-found` and `moved`; every other failure is thrown.
   */
  async lookup<TType extends CatalogLookupType>(
    type: TType,
    mbid: Mbid,
  ): Promise<CatalogAnswer<TType>> {
    const { schema, codes } = LOOKUPS[type];
    const response = await this.requestOrFail(type, { mbid }, schema);
    if (response.ok) {
      return { status: 'found', entity: response.result };
    }
    if (response.error.code === codes.notFound) {
      return { status: 'not-found' };
    }
    if (
      response.error.code === codes.moved &&
      response.error.newMbid !== undefined
    ) {
      return { status: 'moved', newMbid: response.error.newMbid };
    }
    throw catalogErrorOf(response.error);
  }

  private requestOrFail<TOutput>(
    type: string,
    payload: unknown,
    responseSchema: z.ZodType<TOutput>,
  ): Promise<TOutput> {
    if (!this.isConfigured()) {
      throw new AppException(
        'INTERNAL_ERROR',
        'Music catalog is not configured',
      );
    }
    return this.connection.request(type, payload, responseSchema);
  }

  private isConfigured(): boolean {
    return (
      this.env.MUSIC_CATALOG_URL !== undefined &&
      this.env.MUSIC_CATALOG_API_KEY !== undefined
    );
  }
}

/** The result of a successful answer, or the exception its error becomes. */
function resultOrThrow<TResult>(
  response:
    | { ok: true; result: TResult }
    | { ok: false; error: MusicCatalogError },
): TResult {
  if (response.ok) {
    return response.result;
  }
  throw catalogErrorOf(response.error);
}

/**
 * Maps a protocol error to the API's error. A catalog that is still starting
 * is retryable; every other error is an internal one.
 */
function catalogErrorOf(error: MusicCatalogError): AppException {
  if (error.code === 'CATALOG_NOT_READY') {
    return new AppException('SERVICE_UNAVAILABLE', error.message);
  }
  return new AppException('INTERNAL_ERROR', error.message);
}
