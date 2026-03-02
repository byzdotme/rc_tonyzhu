import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createNotifyRouter } from '../../src/api/notify.router.js';
import type { MessageProducer } from '../../src/domain/types.js';
import { NOTIFICATION_TOPIC } from '../../src/service/notification.service.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function createMockProducer(): MessageProducer & {
  send: ReturnType<typeof vi.fn>;
} {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

describe('POST /notify', () => {
  let mockProducer: ReturnType<typeof createMockProducer>;
  let app: express.Application;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    mockProducer = createMockProducer();
    app = express();
    app.use(express.json());
    app.use(createNotifyRouter(mockProducer, logger));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should accept valid notification and return 202', async () => {
    const res = await fetch(`${baseUrl}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: 'order.created',
        payload: { orderId: 'ORD-1' },
      }),
    });

    expect(res.status).toBe(202);
    const data = (await res.json()) as { eventId: string };
    expect(data.eventId).toBe('order.created');
    expect(mockProducer.send).toHaveBeenCalledWith(NOTIFICATION_TOPIC, {
      eventId: 'order.created',
      payload: { orderId: 'ORD-1' },
      attempt: 0,
    });
  });

  it('should return 400 when eventId is missing', async () => {
    const res = await fetch(`${baseUrl}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { orderId: 'ORD-1' } }),
    });

    expect(res.status).toBe(400);
    expect(mockProducer.send).not.toHaveBeenCalled();
  });

  it('should return 400 when payload is missing', async () => {
    const res = await fetch(`${baseUrl}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: 'order.created' }),
    });

    expect(res.status).toBe(400);
  });

  it('should return 500 when producer fails', async () => {
    mockProducer.send.mockRejectedValue(new Error('Kafka unavailable'));

    const res = await fetch(`${baseUrl}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: 'order.created',
        payload: { orderId: 'ORD-1' },
      }),
    });

    expect(res.status).toBe(500);
  });
});
