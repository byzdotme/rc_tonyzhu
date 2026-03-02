import { Kafka, type Producer, type Consumer, type EachMessagePayload } from 'kafkajs';
import type { NotificationTask, MessageProducer } from '../domain/types.js';
import type { Logger } from 'pino';

const BROKER = process.env['KAFKA_BROKER'] ?? 'localhost:9092';

const kafka = new Kafka({
  clientId: 'webhook-service',
  brokers: [BROKER],
});

export class KafkaMessageProducer implements MessageProducer {
  private producer: Producer;

  constructor() {
    this.producer = kafka.producer();
  }

  async connect(): Promise<void> {
    await this.producer.connect();
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }

  async send(topic: string, message: NotificationTask): Promise<void> {
    await this.producer.send({
      topic,
      messages: [{ key: message.eventId, value: JSON.stringify(message) }],
    });
  }
}

export async function startConsumer(
  groupId: string,
  topic: string,
  handler: (task: NotificationTask) => Promise<void>,
  logger: Logger,
): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload) => {
      if (!message.value) return;
      try {
        const task: NotificationTask = JSON.parse(message.value.toString());
        await handler(task);
      } catch (error) {
        logger.error({ error }, 'Failed to process Kafka message');
      }
    },
  });

  return consumer;
}
