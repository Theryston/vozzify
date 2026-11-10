import type { Logger } from '@nestjs/common';
import type { Locale } from '@vozzify/contracts';
import { homeErrorMessage } from './home-error-message.js';
import type { PersonalHomeQueueService } from './home-personal-queue.service.js';

export const queuePersonalHomeRefresh = async (
  refresh: PersonalHomeQueueService | undefined,
  logger: Pick<Logger, 'warn'>,
  userId: string,
  locale: Locale,
): Promise<void> => {
  try {
    await refresh?.requestRefresh(userId, locale);
  } catch (error) {
    logger.warn(
      `Could not queue the personal home refresh: ${homeErrorMessage(error)}`,
    );
  }
};
