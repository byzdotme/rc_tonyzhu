import express, { type Application } from 'express';
import type { Logger } from 'pino';
import type { MessageProducer } from './domain/types.js';
import { createNotifyRouter } from './api/notify.router.js';

export function createApp(
  producer: MessageProducer,
  logger: Logger,
): Application {
  const app = express();
  app.use(express.json());
  app.use(createNotifyRouter(producer, logger));
  return app;
}
