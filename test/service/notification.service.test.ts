import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotificationService,
  renderTemplates,
  computeBackoffDelay,
  NOTIFICATION_TOPIC,
  DEAD_LETTER_TOPIC,
} from '../../src/service/notification.service.js';
import type {
  NotificationTask,
  NotificationConfig,
  MessageProducer,
} from '../../src/domain/types.js';
import type { NotificationConfigRepository } from '../../src/config/notification-config.repository.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function createMockProducer(): MessageProducer & {
  send: ReturnType<typeof vi.fn>;
} {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

function createMockConfigRepo(
  config?: NotificationConfig,
): NotificationConfigRepository {
  return {
    getByEventId: vi.fn().mockReturnValue(config),
  } as unknown as NotificationConfigRepository;
}

const sampleConfig: NotificationConfig = {
  apiUrl: 'https://example.com/webhook',
  headerTemplates: {
    'Content-Type': 'application/json',
    'X-Event-Id': '{{orderId}}',
  },
  bodyTemplate: '{"orderId":"{{orderId}}","amount":{{amount}}}',
  maxRetries: 5,
};

const sampleTask: NotificationTask = {
  eventId: 'order.created',
  payload: { orderId: 'ORD-123', amount: 99.99 },
  attempt: 0,
};

describe('computeBackoffDelay', () => {
  it('should compute exponential delay', () => {
    expect(computeBackoffDelay(0)).toBe(1000);
    expect(computeBackoffDelay(1)).toBe(2000);
    expect(computeBackoffDelay(2)).toBe(4000);
    expect(computeBackoffDelay(3)).toBe(8000);
  });

  it('should cap at 10000ms', () => {
    expect(computeBackoffDelay(4)).toBe(10_000);
    expect(computeBackoffDelay(10)).toBe(10_000);
  });
});

describe('renderTemplates', () => {
  it('should render headers and body using mustache', () => {
    const result = renderTemplates(sampleConfig, sampleTask.payload);
    expect(result.headers['Content-Type']).toBe('application/json');
    expect(result.headers['X-Event-Id']).toBe('ORD-123');
    expect(result.body).toBe('{"orderId":"ORD-123","amount":99.99}');
  });

  it('should handle missing payload fields gracefully', () => {
    const result = renderTemplates(sampleConfig, {});
    expect(result.headers['X-Event-Id']).toBe('');
    expect(result.body).toContain('"orderId":""');
  });
});

describe('NotificationService', () => {
  let mockProducer: ReturnType<typeof createMockProducer>;
  let mockDelayFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockProducer = createMockProducer();
    mockDelayFn = vi.fn().mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  it('should deliver notification successfully', async () => {
    const configRepo = createMockConfigRepo(sampleConfig);
    const service = new NotificationService(
      configRepo,
      mockProducer,
      logger,
      mockDelayFn,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );

    await service.processTask(sampleTask);

    expect(fetch).toHaveBeenCalledWith('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Event-Id': 'ORD-123',
      },
      body: '{"orderId":"ORD-123","amount":99.99}',
    });
    expect(mockProducer.send).not.toHaveBeenCalled();
  });

  it('should skip processing when config not found', async () => {
    const configRepo = createMockConfigRepo(undefined);
    const service = new NotificationService(
      configRepo,
      mockProducer,
      logger,
      mockDelayFn,
    );

    await service.processTask(sampleTask);

    expect(mockProducer.send).not.toHaveBeenCalled();
  });

  it('should retry with exponential backoff on HTTP failure', async () => {
    const configRepo = createMockConfigRepo(sampleConfig);
    const service = new NotificationService(
      configRepo,
      mockProducer,
      logger,
      mockDelayFn,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );

    await service.processTask({ ...sampleTask, attempt: 2 });

    expect(mockDelayFn).toHaveBeenCalledWith(4000);
    expect(mockProducer.send).toHaveBeenCalledWith(NOTIFICATION_TOPIC, {
      ...sampleTask,
      attempt: 3,
    });
  });

  it('should retry with backoff on first attempt failure', async () => {
    const configRepo = createMockConfigRepo(sampleConfig);
    const service = new NotificationService(
      configRepo,
      mockProducer,
      logger,
      mockDelayFn,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error')),
    );

    await service.processTask(sampleTask);

    expect(mockDelayFn).toHaveBeenCalledWith(1000);
    expect(mockProducer.send).toHaveBeenCalledWith(NOTIFICATION_TOPIC, {
      ...sampleTask,
      attempt: 1,
    });
  });

  it('should send to dead letter queue when max retries reached', async () => {
    const configRepo = createMockConfigRepo(sampleConfig);
    const service = new NotificationService(
      configRepo,
      mockProducer,
      logger,
      mockDelayFn,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      }),
    );

    const failedTask = { ...sampleTask, attempt: 4 };
    await service.processTask(failedTask);

    expect(mockProducer.send).toHaveBeenCalledWith(
      DEAD_LETTER_TOPIC,
      failedTask,
    );
    expect(mockDelayFn).not.toHaveBeenCalled();
  });

  it('should send to dead letter when network error at max retries', async () => {
    const configRepo = createMockConfigRepo(sampleConfig);
    const service = new NotificationService(
      configRepo,
      mockProducer,
      logger,
      mockDelayFn,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Connection refused')),
    );

    const failedTask = { ...sampleTask, attempt: 4 };
    await service.processTask(failedTask);

    expect(mockProducer.send).toHaveBeenCalledWith(
      DEAD_LETTER_TOPIC,
      failedTask,
    );
    expect(mockDelayFn).not.toHaveBeenCalled();
  });

  it('should respect custom maxRetries from config', async () => {
    const customConfig = { ...sampleConfig, maxRetries: 2 };
    const configRepo = createMockConfigRepo(customConfig);
    const service = new NotificationService(
      configRepo,
      mockProducer,
      logger,
      mockDelayFn,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Error',
      }),
    );

    const task = { ...sampleTask, attempt: 1 };
    await service.processTask(task);

    expect(mockProducer.send).toHaveBeenCalledWith(DEAD_LETTER_TOPIC, task);
  });
});
