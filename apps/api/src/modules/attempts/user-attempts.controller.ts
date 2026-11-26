import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { PracticeAttemptHistoryPage } from '@vozzify/contracts';
import { practiceAttemptHistoryPageSchema } from '@vozzify/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import type { AuthUser } from '../auth/auth.js';
import { ProfileVisibilityService } from '../users/profile-visibility.service.js';
import { ListUserAttemptsQueryDto } from './list-user-attempts-query.dto.js';
import { UserAttemptsService } from './user-attempts.service.js';
import { UserAttemptsParamDto } from './user-attempts-param.dto.js';

// Anonymous: a Profile's history is public, like the Profile itself.
@ApiTags('attempts')
@Public()
@Controller('users')
export class UserAttemptsController {
  constructor(
    private readonly userAttempts: UserAttemptsService,
    private readonly profileVisibility: ProfileVisibilityService,
  ) {}

  @Get(':username/attempts')
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(practiceAttemptHistoryPageSchema)
  @ApiOkResponse({
    description: "The User's practice history, newest first.",
  })
  @ApiBadRequestResponse({
    description: 'The cursor is not one this API issued.',
  })
  @ApiNotFoundResponse({
    description:
      'No User has this username, or the owner hid this section (`NOT_FOUND`).',
  })
  async listHistory(
    @Param() params: UserAttemptsParamDto,
    @Query() query: ListUserAttemptsQueryDto,
    @CurrentUser() viewer: AuthUser | undefined,
  ): Promise<PracticeAttemptHistoryPage> {
    await this.profileVisibility.readSection(
      params.username,
      'practiceHistory',
      viewer?.id,
    );
    return this.userAttempts.listHistory(params.username, query, viewer?.id);
  }
}
