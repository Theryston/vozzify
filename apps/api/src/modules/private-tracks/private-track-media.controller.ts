import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import type { AuthUser } from '../auth/auth.js';
import { PrivateTrackMediaService } from './private-track-media.service.js';

class PrivateTrackMediaParamDto extends createZodDto(
  z.object({
    id: z.string().min(1).max(128),
    kind: z.enum(['music', 'vocals']),
  }),
) {}

@Controller('me/private-tracks')
export class PrivateTrackMediaController {
  constructor(private readonly media: PrivateTrackMediaService) {}

  @Get(':id/media/:kind')
  async audio(
    @CurrentUser() user: AuthUser,
    @Param() params: PrivateTrackMediaParamDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const audio = await this.media.prepareAudio(
      user.id,
      params.id,
      params.kind,
      request.headers.range,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Type', 'audio/wav');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (audio.invalidRange) {
      response.setHeader('Content-Range', `bytes */${audio.size}`);
      response.status(416).end();
      return;
    }

    const { range } = audio;
    const start = range?.start ?? 0;
    const end = range?.end ?? audio.size - 1;
    response.setHeader('Content-Length', String(end - start + 1));
    if (range) {
      response.status(206);
      response.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${audio.size}`,
      );
    }
    audio.body?.once('error', (error) => response.destroy(error));
    request.once('aborted', () => audio.body?.destroy());
    response.once('close', () => audio.body?.destroy());
    audio.body?.pipe(response);
  }
}
