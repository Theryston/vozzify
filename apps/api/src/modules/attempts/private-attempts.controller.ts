import { Body, Controller, Header, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type PracticeAttempt,
  practiceAttemptSchema,
} from '@vozzify/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import type { AuthUser } from '../auth/auth.js';
import { AttemptTrackParamDto } from './attempt-track-param.dto.js';
import { PrivateAttemptsService } from './private-attempts.service.js';
import { SubmitPrivateAttemptBodyDto } from './submit-private-attempt-body.dto.js';

@ApiTags('attempts')
@Controller('me/private-tracks/:trackId/attempts')
export class PrivateAttemptsController {
  constructor(private readonly attempts: PrivateAttemptsService) {}

  @Post()
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(practiceAttemptSchema)
  @ApiCreatedResponse({ description: 'The saved private attempt.' })
  @ApiBadRequestResponse({ description: 'The run is not valid.' })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  @ApiForbiddenResponse({ description: 'The owner needs a Pro membership.' })
  @ApiNotFoundResponse({
    description: 'No playable private Track for the owner.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The run covered too little or skipped forward.',
  })
  submitAttempt(
    @CurrentUser() user: AuthUser,
    @Param() params: AttemptTrackParamDto,
    @Body() body: SubmitPrivateAttemptBodyDto,
  ): Promise<PracticeAttempt> {
    return this.attempts.submit(user.id, params.trackId, body);
  }
}
