import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { privateTrackMediaParamsSchema } from '@vozzify/contracts';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import type { AuthUser } from '../auth/auth.js';
import { PrivateTrackMediaService } from './private-track-media.service.js';

class PrivateTrackMediaParamDto extends createZodDto(
  privateTrackMediaParamsSchema,
) {}

@Controller('me/private-tracks')
@ApiTags('private tracks')
export class PrivateTrackMediaController {
  constructor(private readonly media: PrivateTrackMediaService) {}

  @Get(':id/media/:kind')
  @ApiParam({
    name: 'id',
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiParam({ name: 'kind', enum: ['music', 'vocals'] })
  @ApiOkResponse({ description: 'A private audio byte range.' })
  @ApiResponse({
    status: 206,
    description: 'A partial private audio response.',
  })
  @ApiResponse({
    status: 416,
    description: 'The byte range is not satisfiable.',
  })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  @ApiForbiddenResponse({
    description: 'An active Pro membership is required.',
  })
  @ApiNotFoundResponse({ description: 'The private Track does not exist.' })
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
