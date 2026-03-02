import { logger } from './infrastructure/logger.js';
import {
  KafkaMessageProducer,
  startConsumer,
} from './infrastructure/kafka.js';
import { NotificationConfigRepository } from './config/notification-config.repository.js';
import {
  NotificationService,
  NOTIFICATION_TOPIC,
} from './service/notification.service.js';
import { createApp } from './app.js';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

async function bootstrap(): Promise<void> {
  const producer = new KafkaMessageProducer();
  await producer.connect();
  logger.info('Kafka producer connected');

  const configRepo = new NotificationConfigRepository();
  const notificationService = new NotificationService(
    configRepo,
    producer,
    logger,
  );

  await startConsumer(
    'webhook-notification-group',
    NOTIFICATION_TOPIC,
    (task) => notificationService.processTask(task),
    logger,
  );
  logger.info({ topic: NOTIFICATION_TOPIC }, 'Kafka consumer started');

  const app = createApp(producer, logger);
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Webhook service started');
  });
}

bootstrap().catch((error) => {
  logger.error({ error }, 'Failed to start webhook service');
  process.exit(1);
});
