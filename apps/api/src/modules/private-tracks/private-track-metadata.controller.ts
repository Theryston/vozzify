import { Body, Controller, Header, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type PrivateTrackDetail,
  privateTrackDetailSchema,
  privateTrackIdParamsSchema,
  updatePrivateTrackMetadataBodySchema,
} from '@vozzify/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import type { AuthUser } from '../auth/auth.js';
import { PrivateTrackMetadataService } from './private-track-metadata.service.js';

class PrivateTrackMetadataDto extends createZodDto(
  updatePrivateTrackMetadataBodySchema,
) {}
class PrivateTrackIdParamDto extends createZodDto(privateTrackIdParamsSchema) {}

@ApiTags('private tracks')
@Controller('me/private-tracks')
export class PrivateTrackMetadataController {
  constructor(private readonly metadata: PrivateTrackMetadataService) {}

  @Patch(':id')
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(privateTrackDetailSchema)
  @ApiOkResponse({ description: 'The private Track with corrected metadata.' })
  @ApiBadRequestResponse({ description: 'Invalid metadata or Track ID.' })
  @ApiForbiddenResponse({ description: 'A Pro membership is required.' })
  @ApiNotFoundResponse({
    description: 'The private Track or Recording does not exist.',
  })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  update(
    @CurrentUser() user: AuthUser,
    @Param() params: PrivateTrackIdParamDto,
    @Body() body: PrivateTrackMetadataDto,
  ): Promise<PrivateTrackDetail> {
    return this.metadata.update(user.id, params.id, body);
  }
}
