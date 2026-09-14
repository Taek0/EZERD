import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApplication } from './application.js';
import { readConfig } from './config.js';

const environment = readConfig();
const app = await NestFactory.create<NestExpressApplication>(AppModule);
configureApplication(app);
app.enableShutdownHooks();
await app.listen(environment.PORT, environment.HOST);
