import type { Notification, NotificationType, Prisma } from '@prisma/client';

export const NOTIFICATION_SOCKET_EVENT = 'notification';
export const userNotificationRoom = (userId: string) => `user:${userId}`;

export type NotificationMetadata = Prisma.InputJsonValue;

export interface SendNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: NotificationMetadata;
  /** Skip SMTP even when mail is enabled. */
  skipEmail?: boolean;
  /** Send email even when the user account is deactivated (e.g. deactivation notice). */
  emailDespiteInactive?: boolean;
  /** Skip WebSocket emit (e.g. batch jobs). */
  skipRealtime?: boolean;
  emailSubject?: string;
  emailHtml?: string;
  emailAttachments?: Array<{ filename: string; content: Buffer }>;
}

/**
 * The shape `metadata` carries for a `TASK_ASSIGNED` notification — a work item riding on
 * the existing Notification model rather than a new relational one. See the doc comment on
 * `NotificationType.TASK_ASSIGNED` in schema.prisma for why.
 */
export interface TaskAssignmentMetadata {
  kind: 'TASK_ASSIGNED';
  dueAt: string; // ISO 8601 — Json can't carry a Date, so this is the wire format everywhere
  assignedByUserId: string;
  assignedByName: string;
  /** Free-form pointer to whatever this task is about, e.g. "loan:cliXYZ" or "batch:twara-ev-1". */
  entityRef?: string;
  completedAt?: string;
}

export function isTaskAssignmentMetadata(
  value: unknown,
): value is TaskAssignmentMetadata {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).kind === 'TASK_ASSIGNED'
  );
}

export type NotificationPayload = Pick<
  Notification,
  | 'id'
  | 'userId'
  | 'type'
  | 'title'
  | 'body'
  | 'isRead'
  | 'metadata'
  | 'createdAt'
>;

export function toNotificationPayload(
  notification: Notification,
): NotificationPayload {
  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    isRead: notification.isRead,
    metadata: notification.metadata,
    createdAt: notification.createdAt,
  };
}
