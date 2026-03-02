import { Router, type Request, type Response } from 'express';
import type { Logger } from 'pino';
import type { MessageProducer, NotificationTask } from '../domain/types.js';
import { NOTIFICATION_TOPIC } from '../service/notification.service.js';

export function createNotifyRouter(
  producer: MessageProducer,
  logger: Logger,
): Router {
  const router = Router();

  router.post('/notify', async (req: Request, res: Response) => {
    try {
      const { eventId, payload } = req.body as {
        eventId?: string;
        payload?: Record<string, unknown>;
      };

      if (!eventId || !payload) {
        res.status(400).json({ error: 'eventId and payload are required' });
        return;
      }

      const task: NotificationTask = { eventId, payload, attempt: 0 };
      await producer.send(NOTIFICATION_TOPIC, task);

      logger.info({ eventId }, 'Notification task enqueued');
      res.status(202).json({ message: 'Notification task accepted', eventId });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue notification task');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
