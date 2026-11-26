import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type StreakHeartbeatResult,
  type StreakStatus,
  streakHeartbeatResultSchema,
  streakStatusSchema,
} from '@vozzify/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import type { AuthUser } from '../auth/auth.js';
import { StreakHeartbeatBodyDto } from './streak-heartbeat-body.dto.js';
import { StreakStatusQueryDto } from './streak-status-query.dto.js';
import { StreaksService } from './streaks.service.js';

@ApiTags('streaks')
@Controller('me/streak')
export class StreaksController {
  constructor(private readonly streaks: StreaksService) {}

  @Get()
  @ZodSerializerDto(streakStatusSchema)
  @ApiOkResponse({ description: "Today's practice against the daily target." })
  @ApiBadRequestResponse({ description: 'The time zone is not an IANA zone.' })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  getStatus(
    @CurrentUser() user: AuthUser,
    @Query() query: StreakStatusQueryDto,
  ): Promise<StreakStatus> {
    return this.streaks.getStatus(user.id, query.timeZone);
  }

  // Not a create: the answer is the updated status, and a retried beacon is
  // harmless because the API's clock bounds what a call can credit.
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(streakHeartbeatResultSchema)
  @ApiOkResponse({ description: 'The status after crediting the heartbeat.' })
  @ApiBadRequestResponse({
    description: 'The elapsed seconds are negative or the zone is unknown.',
  })
  @ApiForbiddenResponse({ description: 'The private Track owner needs Pro.' })
  @ApiNotFoundResponse({
    description: 'No playable private Track for the owner.',
  })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  heartbeat(
    @CurrentUser() user: AuthUser,
    @Body() body: StreakHeartbeatBodyDto,
  ): Promise<StreakHeartbeatResult> {
    return this.streaks.heartbeat(user.id, body);
  }
}
