import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  MusicCatalogSearchParams,
  SearchResult,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';
import { SonicService } from '../../integrations/sonic/sonic.service.js';
import { TracksSearchService } from '../tracks/tracks-search.service.js';

const RECOVERY_RETRY_MS = 3_000;
const PROBE_QUERY = 'vozzify primary health check';

@Injectable()
export class SearchService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private primaryUnavailable = false;
  private shuttingDown = false;
  private recoveryTimer: NodeJS.Timeout | undefined;
  private verificationInFlight = false;
  private observedGeneration = 0;
  private outageGeneration = 0;
  private removeCloseListener: (() => void) | undefined;

  constructor(
    private readonly catalog: MusicCatalogClient,
    private readonly sonic: SonicService,
    private readonly tracks: TracksSearchService,
  ) {}

  onModuleInit(): void {
    this.removeCloseListener = this.catalog.onSearchConnectionClosed(() => {
      if (this.shuttingDown) return;
      this.markPrimaryUnavailable(
        new AppException('SERVICE_UNAVAILABLE', 'Music catalog disconnected'),
        true,
      );
    });
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
    if (this.recoveryTimer !== undefined) clearTimeout(this.recoveryTimer);
    this.removeCloseListener?.();
  }

  async search(params: MusicCatalogSearchParams): Promise<SearchResult> {
    const state = this.catalog.searchRoutingState();
    if (state.generation !== this.observedGeneration) {
      this.observedGeneration = state.generation;
      this.markPrimaryUnavailable(
        new AppException('SERVICE_UNAVAILABLE', 'Music catalog disconnected'),
        true,
      );
    }
    if (this.primaryUnavailable) {
      this.markPrimaryUnavailable(
        new AppException('SERVICE_UNAVAILABLE', 'Music catalog disconnected'),
      );
      return this.searchSonic(params);
    }
    try {
      const result = state.connected
        ? await this.catalog.searchIfConnected(params)
        : await this.catalog.search(params);
      const currentState = this.catalog.searchRoutingState();
      if (currentState.generation !== this.observedGeneration) {
        this.observedGeneration = currentState.generation;
        this.markPrimaryUnavailable(
          new AppException('SERVICE_UNAVAILABLE', 'Music catalog disconnected'),
          true,
        );
      }
      return { ...result, source: 'music-catalog' };
    } catch (error: unknown) {
      if (!isAvailabilityFailure(error)) throw error;
      this.markPrimaryUnavailable(error, true);
      return this.searchSonic(params);
    }
  }

  private async searchSonic(
    params: MusicCatalogSearchParams,
  ): Promise<SearchResult> {
    const ids = await this.sonic.search(
      params.query,
      params.limit,
      params.offset,
    );
    const results = await this.tracks.findSearchResults(ids);
    return { results, source: 'sonic' };
  }

  private markPrimaryUnavailable(error: unknown, newOutage = false): void {
    if (!this.primaryUnavailable) {
      this.logger.warn(
        `Music catalog search unavailable; using Sonic: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!this.primaryUnavailable || newOutage) this.outageGeneration += 1;
    this.primaryUnavailable = true;
    this.scheduleVerification();
  }

  private scheduleVerification(): void {
    if (
      this.shuttingDown ||
      this.verificationInFlight ||
      this.recoveryTimer !== undefined
    ) {
      return;
    }
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      if (this.shuttingDown) return;
      this.verificationInFlight = true;
      void this.verifyPrimary()
        .catch((error: unknown) => {
          this.logger.warn(
            `Music catalog verification failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        })
        .finally(() => {
          this.verificationInFlight = false;
          if (!this.shuttingDown && this.primaryUnavailable) {
            this.scheduleVerification();
          }
        });
    }, RECOVERY_RETRY_MS);
    this.recoveryTimer.unref();
  }

  private async verifyPrimary(): Promise<void> {
    if (this.shuttingDown || !this.primaryUnavailable) return;
    let probeGeneration = this.outageGeneration;
    const state = this.catalog.searchRoutingState();
    if (state.generation !== this.observedGeneration) {
      this.observedGeneration = state.generation;
      this.markPrimaryUnavailable(
        new AppException('SERVICE_UNAVAILABLE', 'Music catalog reconnected'),
        true,
      );
      probeGeneration = this.outageGeneration;
    }
    if (state.connected) {
      await this.catalog.searchIfConnected({
        query: PROBE_QUERY,
        limit: 1,
        offset: 0,
      });
      if (this.shuttingDown) return;
      const verifiedState = this.catalog.searchRoutingState();
      if (verifiedState.generation !== state.generation) {
        this.observedGeneration = verifiedState.generation;
        this.markPrimaryUnavailable(
          new AppException('SERVICE_UNAVAILABLE', 'Music catalog disconnected'),
          true,
        );
        return;
      }
      if (!verifiedState.connected) return;
      if (this.outageGeneration !== probeGeneration) return;
      this.observedGeneration = verifiedState.generation;
      this.primaryUnavailable = false;
      this.logger.log('Music catalog search verified; primary routing resumed');
      return;
    }
  }
}

const isAvailabilityFailure = (error: unknown): boolean =>
  error instanceof AppException &&
  (error.code === 'SERVICE_UNAVAILABLE' || error.code === 'GATEWAY_TIMEOUT');
