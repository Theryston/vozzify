import type { AvatarIdentity } from '@vozzify/contracts';

/** Shared by the interactive Avatar and the server-rendered share image. */
export function avatarTreatment(identity?: AvatarIdentity) {
  return identity?.pro ? 'studio-single' : 'round';
}
