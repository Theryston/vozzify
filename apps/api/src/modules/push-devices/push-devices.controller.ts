import { Body, Controller, HttpCode, HttpStatus, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { syncPushDeviceBodySchema } from '@vozzify/contracts';
import { AllowMissingUsername } from '../../common/decorators/allow-missing-username.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import type { AuthUser } from '../auth/auth.js';
import { PushDevicesService } from './push-devices.service.js';

class SyncPushDeviceBodyDto extends createZodDto(syncPushDeviceBodySchema) {}

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
    @Body() body: SyncPushDeviceBodyDto,
  ): Promise<void> {
    return this.devices.sync(user, body);
  }
}
