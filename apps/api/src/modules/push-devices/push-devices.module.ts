import { Module } from '@nestjs/common';
import { PushDevicesController } from './push-devices.controller.js';
import { PushDevicesRepository } from './push-devices.repository.js';
import { PushDevicesService } from './push-devices.service.js';

@Module({
  controllers: [PushDevicesController],
  providers: [PushDevicesRepository, PushDevicesService],
})
export class PushDevicesModule {}
