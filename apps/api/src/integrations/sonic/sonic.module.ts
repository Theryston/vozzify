import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { SonicService } from './sonic.service.js';

@Module({
  imports: [ConfigModule],
  providers: [SonicService],
  exports: [SonicService],
})
export class SonicModule {}
