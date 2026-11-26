import { Body, Controller, Header, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  createPrivateYouTubeTrackBodySchema,
  type PrivateTrack,
  privateTrackSchema,
} from '@vozzify/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import type { AuthUser } from '../auth/auth.js';
import { PrivateYouTubeTracksService } from './private-youtube-tracks.service.js';

class CreatePrivateYouTubeTrackBodyDto extends createZodDto(
  createPrivateYouTubeTrackBodySchema,
) {}

@ApiTags('private tracks')
@Controller('me/private-tracks/youtube')
export class PrivateYouTubeTracksController {
  constructor(private readonly tracks: PrivateYouTubeTracksService) {}

  @Post()
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ type: CreatePrivateYouTubeTrackBodyDto })
  @ZodSerializerDto(privateTrackSchema)
  @ApiCreatedResponse({ description: 'The owner-scoped YouTube submission.' })
  @ApiBadRequestResponse({
    description: 'The YouTube link or duration is invalid.',
  })
  @ApiForbiddenResponse({
    description: 'A current Pro membership is required.',
  })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  @ApiServiceUnavailableResponse({
    description: 'The video could not be read.',
  })
  submit(
    @CurrentUser() user: AuthUser,
    @Body() body: CreatePrivateYouTubeTrackBodyDto,
  ): Promise<PrivateTrack> {
    return this.tracks.submit(user.id, body.url);
  }
}
