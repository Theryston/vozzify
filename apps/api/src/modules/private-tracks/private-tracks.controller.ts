import {
  Controller,
  Get,
  Header,
  Post,
  Query,
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
  type MyPrivateTracksPage,
  myPrivateTracksPageSchema,
  myPrivateTracksQuerySchema,
  PRIVATE_AUDIO_MAX_BYTES,
  type PrivateTrack,
  privateAudioSizeSchema,
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
class ListPrivateTracksQueryDto extends createZodDto(
  myPrivateTracksQuerySchema,
) {}
class CreatePrivateTrackBodyDto extends createZodDto(
  createPrivateTrackBodySchema,
) {}

@ApiTags('private tracks')
@Controller('me/private-tracks')
export class PrivateTracksController {
  constructor(private readonly privateTracks: PrivateTracksService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(myPrivateTracksPageSchema)
  @ApiOkResponse({ description: "The signed-in user's private audio entries." })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPrivateTracksQueryDto,
  ): Promise<MyPrivateTracksPage> {
    return this.privateTracks.listPage(user.id, query);
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
      const size = privateAudioSizeSchema.safeParse(file.size);
      if (!size.success) {
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
