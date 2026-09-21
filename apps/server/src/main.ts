import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApplication } from './application.js';
import { readConfig } from './config.js';
import { SyncGateway } from './sync/sync.gateway.js';

const environment = readConfig();
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
configureApplication(app);
app.get(SyncGateway).attach(app.getHttpServer());
app.enableShutdownHooks();
await app.listen(environment.PORT, environment.HOST);
