import {
  Controller,
  Get,
  Header,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  createPrivateTrackBodySchema,
  type MyPrivateTracks,
  myPrivateTracksSchema,
  PRIVATE_AUDIO_MAX_BYTES,
  type PrivateTrack,
  privateTrackSchema,
} from '@vozzify/contracts';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import type { AuthUser } from '../auth/auth.js';
import { invalidPrivateAudio } from './private-audio.js';
import {
  PrivateAudioUploadInterceptor,
  removePrivateAudioUpload,
} from './private-audio-upload.interceptor.js';
import { PrivateTracksService } from './private-tracks.service.js';

type UploadedAudio = { path: string; originalname: string; size: number };
type RequestWithUpload = Request & { privateAudioDirectory?: string };
class CreatePrivateTrackBodyDto extends createZodDto(
  createPrivateTrackBodySchema,
) {}

@ApiTags('private tracks')
@Controller('me/private-tracks')
export class PrivateTracksController {
  constructor(private readonly privateTracks: PrivateTracksService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(myPrivateTracksSchema)
  @ApiOkResponse({ description: "The signed-in user's private audio entries." })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  list(@CurrentUser() user: AuthUser): Promise<MyPrivateTracks> {
    return this.privateTracks.list(user.id);
  }

  @Post()
  @UseInterceptors(PrivateAudioUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreatePrivateTrackBodyDto })
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(privateTrackSchema)
  @ApiCreatedResponse({ description: 'The private audio entry.' })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  async submit(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedAudio | undefined,
    @Req() request: RequestWithUpload,
  ): Promise<PrivateTrack> {
    const directory = request.privateAudioDirectory;
    try {
      if (!file) throw invalidPrivateAudio('Audio file is required');
      if (file.size > PRIVATE_AUDIO_MAX_BYTES) {
        throw invalidPrivateAudio(
          `Audio is larger than ${PRIVATE_AUDIO_MAX_BYTES} bytes`,
        );
      }
      return await this.privateTracks.submit(user.id, file);
    } finally {
      if (directory) await removePrivateAudioUpload(directory);
    }
  }
}
