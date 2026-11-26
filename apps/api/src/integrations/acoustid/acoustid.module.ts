import { Module } from '@nestjs/common';
import { AcoustidClient } from './acoustid.client.js';

@Module({ providers: [AcoustidClient], exports: [AcoustidClient] })
export class AcoustidModule {}
