export interface NotificationTask {
  eventId: string;
  payload: Record<string, unknown>;
  attempt: number;
}

export interface NotificationConfig {
  apiUrl: string;
  headerTemplates: Record<string, string>;
  bodyTemplate: string;
  maxRetries: number;
}

export interface MessageProducer {
  send(topic: string, message: NotificationTask): Promise<void>;
}
