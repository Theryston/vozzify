import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type CreatePrivateTrackBody,
  createPrivateTrackBodySchema,
  type MyPrivateTracksPage,
  myPrivateTracksPageSchema,
  myPrivateTracksQuerySchema,
  type PrivateTrack,
  type PrivateTrackDetail,
  privateTrackDetailSchema,
  privateTrackIdParamsSchema,
  privateTrackSchema,
} from '@vozzify/contracts';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import type { AuthUser } from '../auth/auth.js';
import { PrivateAudioUploadInterceptor } from './private-audio-upload.interceptor.js';
import { PrivateTrackWorkflowService } from './private-track-workflow.service.js';
import { PrivateTracksService } from './private-tracks.service.js';

type RequestWithUpload = Request & {
  file?: { path: string; originalname: string };
};
class ListPrivateTracksQueryDto extends createZodDto(
  myPrivateTracksQuerySchema,
) {}
class CreatePrivateTrackBodyDto extends createZodDto(
  createPrivateTrackBodySchema,
) {}
class PrivateTrackIdParamDto extends createZodDto(privateTrackIdParamsSchema) {}

@ApiTags('private tracks')
@Controller('me/private-tracks')
export class PrivateTracksController {
  constructor(
    private readonly privateTracks: PrivateTracksService,
    private readonly workflow: PrivateTrackWorkflowService,
  ) {}

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

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(privateTrackDetailSchema)
  @ApiOkResponse({ description: "The signed-in owner's private Track detail." })
  @ApiNotFoundResponse({ description: 'The private Track does not exist.' })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  detail(
    @CurrentUser() user: AuthUser,
    @Param() params: PrivateTrackIdParamDto,
  ): Promise<PrivateTrackDetail> {
    return this.privateTracks.getDetail(user.id, params.id);
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
    @Body() body: CreatePrivateTrackBodyDto,
    @Req() request: RequestWithUpload,
  ): Promise<PrivateTrack> {
    const file = request.file;
    if (!file) throw new Error('Validated audio file is unavailable');
    const audio: CreatePrivateTrackBody['audio'] = body.audio;
    return this.workflow.submit(user.id, {
      path: file.path,
      originalname: audio.name,
    });
  }
}
