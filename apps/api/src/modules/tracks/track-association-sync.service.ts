import { Injectable } from '@nestjs/common';
import { TrackAssociationService } from './track-association.service.js';
import { TrackAssociationEventRepository } from './track-association-event.repository.js';
import { TrackAssociationSyncRepository } from './track-association-sync.repository.js';

const PAGE_SIZE = 250;
const WAIT_INTERVAL_MS = 1_000;

/** Rerunnable operator backfill; it waits for catalog acknowledgments per page. */
@Injectable()
export class TrackAssociationSyncService {
  constructor(
    private readonly tracks: TrackAssociationSyncRepository,
    private readonly events: TrackAssociationEventRepository,
    private readonly delivery: TrackAssociationService,
  ) {}

  async synchronize(): Promise<void> {
    let afterId: string | undefined;
    for (;;) {
      const page = await this.tracks.findAndEnqueuePage(
        afterId,
        PAGE_SIZE,
        (rows) => this.events.enqueueSynchronizationPage(rows),
      );
      if (page.length === 0) break;
      await this.waitForPage(page.map((track) => track.id));
      afterId = page.at(-1)?.id;
    }
    await this.waitForOutbox();
  }

  private async waitForPage(trackIds: string[]): Promise<void> {
    await this.waitUntilSettled(() =>
      this.events.countPendingForTracks(trackIds),
    );
  }

  private async waitForOutbox(): Promise<void> {
    await this.waitUntilSettled(() => this.events.countPending());
  }

  private async waitUntilSettled(
    countPending: () => Promise<{ count: number }[]>,
  ): Promise<void> {
    for (;;) {
      await this.delivery.dispatchPending();
      const pending = await countPending();
      if ((pending[0]?.count ?? 0) === 0) return;
      await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
    }
  }
}
