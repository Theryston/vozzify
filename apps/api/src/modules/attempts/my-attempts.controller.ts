import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type PracticeAttemptPage,
  practiceAttemptPageSchema,
} from '@vozzify/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import type { AuthUser } from '../auth/auth.js';
import { AttemptsService } from './attempts.service.js';
import { ListOwnAttemptsQueryDto } from './list-own-attempts-query.dto.js';

@ApiTags('attempts')
@Controller('me/attempts')
export class MyAttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(practiceAttemptPageSchema)
  @ApiOkResponse({ description: "The User's own attempts, newest first." })
  @ApiBadRequestResponse({
    description: 'The cursor is not one this API issued.',
  })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  listOwn(
    @CurrentUser() user: AuthUser,
    @Query() query: ListOwnAttemptsQueryDto,
  ): Promise<PracticeAttemptPage> {
    return this.attempts.listOwn(user.id, query);
  }
}
