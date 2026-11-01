import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { ENV, type Env } from '../../config/env.js';
import { SonicChannel, SonicChannelError } from './sonic-channel.js';

const SONIC_READY_COLLECTION = 'vozzify_meta';
const SONIC_READY_OBJECT = 'index-ready';
const SONIC_READY_QUERY = 'vozzify-index-ready';
const logger = new Logger('SonicService');

@Injectable()
export class SonicService {
  private readonly searchChannel: SonicChannel;
  private readonly ingestChannel: SonicChannel;

  constructor(@Inject(ENV) env: Env) {
    this.searchChannel = new SonicChannel(env);
    this.ingestChannel = new SonicChannel(env);
  }

  async search(
    query: string,
    limit: number,
    offset: number,
  ): Promise<string[]> {
    try {
      const ready = await this.searchChannel.searchCollection(
        SONIC_READY_COLLECTION,
        SONIC_READY_QUERY,
        1,
        0,
      );
      if (!ready.includes(SONIC_READY_OBJECT)) {
        throw new AppException(
          'SERVICE_UNAVAILABLE',
          'Sonic index has not been initialized',
        );
      }
      return await this.searchChannel.query(query, limit, offset);
    } catch (error: unknown) {
      throw asSonicException(error, 'Sonic search failed');
    }
  }

  async indexTrack(id: string, text: string): Promise<void> {
    try {
      await this.ingestChannel.push(id, text);
    } catch (error: unknown) {
      throw asSonicException(error, 'Sonic indexing failed');
    }
  }

  async removeTrack(id: string): Promise<void> {
    try {
      await this.ingestChannel.removeObject('tracks', 'completed', id);
    } catch (error: unknown) {
      throw asSonicException(error, 'Sonic track removal failed');
    }
  }

  async markIndexReady(): Promise<void> {
    try {
      await this.ingestChannel.pushToCollection(
        SONIC_READY_COLLECTION,
        SONIC_READY_OBJECT,
        SONIC_READY_QUERY,
      );
    } catch (error: unknown) {
      throw asSonicException(error, 'Sonic indexing failed');
    }
  }

  async markIndexNotReady(): Promise<void> {
    try {
      await this.ingestChannel.removeObject(
        SONIC_READY_COLLECTION,
        'completed',
        SONIC_READY_OBJECT,
      );
    } catch (error: unknown) {
      throw asSonicException(error, 'Sonic indexing failed');
    }
  }
}

const asSonicException = (error: unknown, message: string): AppException => {
  if (error instanceof AppException) return error;
  logger.warn(
    `${message}: ${error instanceof Error ? error.message : String(error)}`,
  );
  if (
    error instanceof SonicChannelError &&
    error.failure !== 'timeout' &&
    error.failure !== 'transport'
  ) {
    return new AppException('INTERNAL_ERROR', message);
  }
  return new AppException('SERVICE_UNAVAILABLE', message);
};
