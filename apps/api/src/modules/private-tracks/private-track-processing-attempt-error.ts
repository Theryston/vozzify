export class PrivateTrackProcessingAttemptError extends Error {
  constructor(
    readonly attemptId: string | null,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Private track processing attempt failed${detail}`, { cause });
    this.name = PrivateTrackProcessingAttemptError.name;
  }
}
