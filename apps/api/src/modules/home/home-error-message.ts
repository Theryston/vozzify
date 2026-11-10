export const homeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
