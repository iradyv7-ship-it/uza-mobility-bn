import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { NotificationsGateway } from './notifications.gateway';
import {
  isTaskAssignmentMetadata,
  type SendNotificationInput,
  type TaskAssignmentMetadata,
  toNotificationPayload,
} from './notifications.types';
import { FilterNotificationsDto } from './dto/filter-notifications.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly gateway: NotificationsGateway,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Persist in-app notification, push over WebSocket, and send email when enabled.
   */
  async send(input: SendNotificationInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: input.metadata ?? undefined,
      },
    });

    const payload = toNotificationPayload(notification);

    if (!input.skipRealtime) {
      this.gateway.emitToUser(input.userId, payload);
    }

    if (!input.skipEmail) {
      void this.deliverEmail(
        input.userId,
        {
          title: input.title,
          body: input.body,
          subject: input.emailSubject,
          html: input.emailHtml,
          attachments: input.emailAttachments,
        },
        input.emailDespiteInactive,
      ).catch((error) => {
        this.logger.error(
          `Email delivery failed for user=${input.userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }

    return payload;
  }

  async sendToRoleNames(
    roleNames: string[],
    input: Omit<SendNotificationInput, 'userId'>,
  ) {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        roles: {
          some: {
            role: { name: { in: roleNames } },
          },
        },
      },
      select: { id: true },
      distinct: ['id'],
    });

    const results = await Promise.all(
      users.map((user) => this.send({ ...input, userId: user.id })),
    );

    return results;
  }

  /**
   * Assign a work item to a named person with a deadline — e.g. "Scorah, follow up on the
   * Twara EV batch, due Friday." Rides entirely on the existing notification pipeline
   * (in-app + realtime + email, same as any other notification) rather than a new
   * relational model — see TaskAssignmentMetadata's doc comment.
   */
  async assignTask(input: {
    assigneeUserId: string;
    title: string;
    body: string;
    dueAt: Date;
    assignedByUserId: string;
    assignedByName: string;
    entityRef?: string;
  }) {
    const metadata: TaskAssignmentMetadata = {
      kind: 'TASK_ASSIGNED',
      dueAt: input.dueAt.toISOString(),
      assignedByUserId: input.assignedByUserId,
      assignedByName: input.assignedByName,
      entityRef: input.entityRef,
    };

    return this.send({
      userId: input.assigneeUserId,
      type: 'TASK_ASSIGNED',
      title: input.title,
      body: input.body,
      metadata: metadata as unknown as SendNotificationInput['metadata'],
    });
  }

  /**
   * One person's assigned tasks, soonest deadline first. Sorted in application code
   * rather than via a Prisma `orderBy` on a JSON field, which Postgres supports only
   * through a raw expression Prisma doesn't model portably — and the row count per
   * person here is small enough that this is the honest tradeoff, not a shortcut that
   * will need revisiting the moment the list grows.
   */
  async findTasksForUser(userId: string, includeCompleted = false) {
    const rows = await this.prisma.notification.findMany({
      where: { userId, type: 'TASK_ASSIGNED' },
      orderBy: { createdAt: 'desc' },
    });

    const tasks = rows
      .map((row) => ({ row, meta: row.metadata }))
      .filter((t): t is typeof t & { meta: TaskAssignmentMetadata } =>
        isTaskAssignmentMetadata(t.meta),
      )
      .filter((t) => includeCompleted || !t.meta.completedAt)
      .map(({ row, meta }) => ({
        ...toNotificationPayload(row),
        dueAt: meta.dueAt,
        assignedByUserId: meta.assignedByUserId,
        assignedByName: meta.assignedByName,
        entityRef: meta.entityRef,
        completedAt: meta.completedAt ?? null,
        isOverdue: !meta.completedAt && new Date(meta.dueAt) < new Date(),
      }))
      .sort(
        (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
      );

    return tasks;
  }

  /** Marks a task done without deleting it — the assignment stays visible in its history. */
  async completeTask(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId, type: 'TASK_ASSIGNED' },
    });

    const currentMetadata: unknown = notification?.metadata;
    if (!notification || !isTaskAssignmentMetadata(currentMetadata)) {
      throw new NotFoundException('Task not found');
    }

    const updatedMetadata: TaskAssignmentMetadata = {
      ...currentMetadata,
      completedAt: new Date().toISOString(),
    };

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        metadata:
          updatedMetadata as unknown as SendNotificationInput['metadata'],
      },
    });

    return toNotificationPayload(updated);
  }

  async findForUser(userId: string, filters: FilterNotificationsDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      ...(filters.unreadOnly ? { isRead: false } : {}),
    };

    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    return {
      items: rows.map(toNotificationPayload),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        unreadCount,
      },
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    return { unreadCount: count };
  }

  async markRead(userId: string, notificationId: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Notification not found');
    }

    const notification = await this.prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
    });

    return toNotificationPayload(notification);
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { markedCount: result.count };
  }

  private async deliverEmail(
    userId: string,
    content: {
      title: string;
      body: string;
      subject?: string;
      html?: string;
      attachments?: Array<{ filename: string; content: Buffer }>;
    },
    despiteInactive = false,
  ): Promise<void> {
    if (!this.mailService.isEnabled()) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isActive: true, deletedAt: true },
    });

    if (!user?.email) {
      return;
    }

    if (!despiteInactive && (!user.isActive || user.deletedAt)) {
      return;
    }

    const appName =
      this.configService.get<string>('APP_NAME') ?? 'UZA Mobility';
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const subject = content.subject ?? `[${appName}] ${content.title}`;
    const html =
      content.html ??
      this.mailService.buildNotificationEmailHtml({
        appName,
        title: content.title,
        body: content.body,
        frontendUrl,
      });

    await this.mailService.sendMail({
      to: user.email,
      subject,
      html,
      text: content.body,
      bufferAttachments: content.attachments,
    });
  }
}
