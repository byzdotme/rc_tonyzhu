import Mustache from 'mustache';
import type { Logger } from 'pino';
import type {
  NotificationTask,
  NotificationConfig,
  MessageProducer,
} from '../domain/types.js';
import type { NotificationConfigRepository } from '../config/notification-config.repository.js';

export const NOTIFICATION_TOPIC = 'notification-tasks';
export const DEAD_LETTER_TOPIC = 'notification-tasks-dead-letter';

export function computeBackoffDelay(attempt: number): number {
  return Math.min(2 ** attempt * 1000, 10_000);
}

export function renderTemplates(
  config: NotificationConfig,
  payload: Record<string, unknown>,
): { headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = {};
  for (const [key, template] of Object.entries(config.headerTemplates)) {
    headers[key] = Mustache.render(template, payload);
  }
  const body = Mustache.render(config.bodyTemplate, payload);
  return { headers, body };
}

export class NotificationService {
  constructor(
    private readonly configRepo: NotificationConfigRepository,
    private readonly producer: MessageProducer,
    private readonly logger: Logger,
    private readonly delayFn: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async processTask(task: NotificationTask): Promise<void> {
    const config = this.configRepo.getByEventId(task.eventId);
    if (!config) {
      this.logger.error(
        { eventId: task.eventId },
        'No notification config found for eventId',
      );
      return;
    }

    const { headers, body } = renderTemplates(config, task.payload);

    try {
      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.logger.info(
        { eventId: task.eventId, attempt: task.attempt, apiUrl: config.apiUrl },
        'Notification delivered successfully',
      );
    } catch (error) {
      const nextAttempt = task.attempt + 1;

      if (nextAttempt >= config.maxRetries) {
        this.logger.error(
          { eventId: task.eventId, attempt: task.attempt, err: error },
          'Max retries reached, sending to dead letter queue',
        );
        await this.producer.send(DEAD_LETTER_TOPIC, task);
        return;
      }

      const delayMs = computeBackoffDelay(task.attempt);
      this.logger.warn(
        { eventId: task.eventId, attempt: task.attempt, nextAttempt, delayMs },
        'Notification failed, scheduling retry',
      );
      await this.delayFn(delayMs);
      await this.producer.send(NOTIFICATION_TOPIC, {
        ...task,
        attempt: nextAttempt,
      });
    }
  }
}
