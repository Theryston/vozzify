import { Module } from '@nestjs/common';
import { YouTubeMusicModule } from '../youtube-music/youtube-music.module.js';
import { AudioDownloadClient } from './audio-download.client.js';

@Module({
  imports: [YouTubeMusicModule],
  providers: [AudioDownloadClient],
  exports: [AudioDownloadClient],
})
export class AudioDownloadModule {}
