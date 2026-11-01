import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { SearchIndexModule } from './modules/search/search-index.module.js';
import { SearchIndexService } from './modules/search/search-index.service.js';
import { TrackAssociationSyncModule } from './modules/tracks/track-association-sync.module.js';
import { TrackAssociationSyncService } from './modules/tracks/track-association-sync.service.js';
import { configureApp, createAppLogger } from './setup-app.js';

const env = loadEnv();
if (process.argv.includes('--sync-sonic-index')) {
  const app = await NestFactory.createApplicationContext(SearchIndexModule, {
    logger: createAppLogger(env),
  });
  try {
    await app.get(SearchIndexService).rebuild();
  } finally {
    await app.close();
  }
} else if (process.argv.includes('--sync-track-associations')) {
  const app = await NestFactory.createApplicationContext(
    TrackAssociationSyncModule,
    { logger: createAppLogger(env) },
  );
  try {
    await app.get(TrackAssociationSyncService).synchronize();
  } finally {
    await app.close();
  }
} else {
  const app = await NestFactory.create(AppModule, {
    logger: createAppLogger(env),
  });
  configureApp(app);
  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`API listening on port ${env.PORT}`);
}
