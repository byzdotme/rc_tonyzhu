import type { NotificationConfig } from '../domain/types.js';

const configStore = new Map<string, NotificationConfig>([
  [
    'order.created',
    {
      apiUrl: 'https://partner-api.example.com/webhooks/orders',
      headerTemplates: {
        'Content-Type': 'application/json',
        'X-Event-Id': '{{orderId}}',
      },
      bodyTemplate:
        '{"orderId":"{{orderId}}","amount":{{amount}},"customerName":"{{customerName}}"}',
      maxRetries: 5,
    },
  ],
  [
    'user.registered',
    {
      apiUrl: 'https://crm.example.com/hooks/new-user',
      headerTemplates: {
        'Content-Type': 'application/json',
        'X-User-Id': '{{userId}}',
      },
      bodyTemplate:
        '{"userId":"{{userId}}","email":"{{email}}","registeredAt":"{{registeredAt}}"}',
      maxRetries: 5,
    },
  ],
]);

export class NotificationConfigRepository {
  getByEventId(eventId: string): NotificationConfig | undefined {
    return configStore.get(eventId);
  }
}
