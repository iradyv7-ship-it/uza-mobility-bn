import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server } from 'socket.io';
import type { UzaSocket } from './ws.types';
import {
  NOTIFICATION_SOCKET_EVENT,
  type NotificationPayload,
  userNotificationRoom,
} from './notifications.types';
import { WsAuthService } from './ws-auth.service';

/**
 * The same origin list as the HTTP API (CORS_ORIGINS), read at class-definition time because
 * the gateway decorator runs before Nest's ConfigService exists. `origin: true` would reflect
 * any caller's Origin header back with credentials — fine on a laptop, not behind a public
 * load balancer.
 */
const wsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: wsOrigins.length
      ? wsOrigins
      : [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:5173',
        ],
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly wsAuth: WsAuthService) {}

  async handleConnection(client: UzaSocket): Promise<void> {
    const user = await this.wsAuth.authenticate(client);

    if (!user) {
      this.logger.debug(`WS rejected: ${client.id}`);
      client.disconnect(true);
      return;
    }

    client.data.userId = user.sub;
    await client.join(userNotificationRoom(user.sub));
    this.logger.debug(`WS connected: user=${user.sub} socket=${client.id}`);
  }

  handleDisconnect(client: UzaSocket): void {
    const userId = client.data.userId;
    if (userId) {
      this.logger.debug(`WS disconnected: user=${userId} socket=${client.id}`);
    }
  }

  emitToUser(userId: string, payload: NotificationPayload): void {
    if (!this.server) {
      return;
    }

    this.server
      .to(userNotificationRoom(userId))
      .emit(NOTIFICATION_SOCKET_EVENT, payload);
  }
}
