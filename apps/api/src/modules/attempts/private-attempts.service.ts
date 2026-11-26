import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type {
  PracticeAttempt,
  SubmitPrivatePracticeAttemptBody,
} from '@vozzify/contracts';
import { PrivateTrackPracticeAccessService } from '../private-tracks/private-track-practice-access.service.js';
import { UsersService } from '../users/users.service.js';
import { toPracticeAttempt } from './attempt-view.js';
import { AttemptsRepository } from './attempts.repository.js';
import { qualifyingAttempt } from './practice-attempt-rules.js';

@Injectable()
export class PrivateAttemptsService {
  constructor(
    private readonly attempts: AttemptsRepository,
    private readonly access: PrivateTrackPracticeAccessService,
    private readonly users: UsersService,
  ) {}

  async submit(
    userId: string,
    trackId: string,
    body: SubmitPrivatePracticeAttemptBody,
  ): Promise<PracticeAttempt> {
    const attempt = await this.save(userId, trackId, body);
    await this.users.revalidatePublicProfile(userId);
    return attempt;
  }

  @Transactional()
  private async save(
    userId: string,
    trackId: string,
    body: SubmitPrivatePracticeAttemptBody,
  ): Promise<PracticeAttempt> {
    await this.access.assertCanPractice(userId, trackId);
    const row = await this.attempts.insertPrivate({
      ...qualifyingAttempt(body),
      userId,
      privateTrackId: trackId,
    });
    return toPracticeAttempt({ ...row, trackId, isPrivate: true });
  }
}
