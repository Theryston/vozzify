import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthSession, AuthUser } from '../../modules/auth/auth.js';

/** Request after the global `AuthGuard` resolved its session. */
export type AuthenticatedRequest = Request & {
  user?: AuthUser;
  authSession?: AuthSession['session'];
};

export const currentUserFromContext = (
  context: ExecutionContext,
): AuthUser | undefined =>
  context.switchToHttp().getRequest<AuthenticatedRequest>().user;

/**
 * The signed-in user resolved by the global `AuthGuard`. Always set on
 * private routes; `undefined` on `@Public()` routes for signed-out requests.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    currentUserFromContext(context),
);

/** The session that the global AuthGuard resolved for this request. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authSession,
);
