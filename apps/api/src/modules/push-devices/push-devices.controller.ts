import { Body, Controller, HttpCode, HttpStatus, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type SyncPushDeviceBody,
  syncPushDeviceBodySchema,
} from '@vozzify/contracts';
import type { z } from 'zod';
import { AllowMissingUsername } from '../../common/decorators/allow-missing-username.decorator.js';
import {
  CurrentSession,
  CurrentUser,
} from '../../common/decorators/current-user.decorator.js';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import type { AuthSession, AuthUser } from '../auth/auth.js';
import { PushDevicesService } from './push-devices.service.js';

// TypeScript classes cannot extend a constructor typed as a union. The
// Nest validation pipe still parses the original discriminated schema.
class SyncPushDeviceBodyDto extends createZodDto<z.ZodType<object>>(
  syncPushDeviceBodySchema,
) {}

@ApiTags('push-devices')
@Controller('me/push-devices')
export class PushDevicesController {
  constructor(private readonly devices: PushDevicesService) {}

  @AllowMissingUsername()
  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description: 'The installation state was reconciled.',
  })
  @ApiBadRequestResponse({ description: 'The installation state is invalid.' })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  @ApiForbiddenResponse({
    description: 'The installation proof or User eligibility is missing.',
  })
  @ApiConflictResponse({
    description: 'The push token is in use by another installation.',
  })
  sync(
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: AuthSession['session'],
    @Body() body: SyncPushDeviceBodyDto,
  ): Promise<void> {
    return this.devices.sync(
      { user, sessionId: session.id },
      body as SyncPushDeviceBody,
    );
  }
}
