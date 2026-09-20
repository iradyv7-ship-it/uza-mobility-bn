import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';
import type { Request } from 'express';
import { AuditService } from './audit.service';
import { AUDIT_ACTION_KEY } from './decorators/audited.decorator';
import { SKIP_AUDIT_KEY } from './decorators/skip-audit.decorator';
import { getRequestAuditContext } from './request-context.util';

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    if (!MUTATION_METHODS.has(method)) {
      return next.handle();
    }

    const skipAudit = this.reflector.getAllAndOverride<boolean>(
      SKIP_AUDIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipAudit) {
      return next.handle();
    }

    const customAction = this.reflector.getAllAndOverride<string>(
      AUDIT_ACTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const auditContext = getRequestAuditContext(request);
    const user = request.user;

    /*
     * The response body passes through untouched.
     *
     * `next.handle()` is `Observable<any>` in @nestjs/common, so `data` arrives
     * untyped. It is annotated `unknown` because this interceptor never reads it —
     * it writes an audit row and then hands the body back exactly as received.
     * Typing it as `unknown` says that, and stops a later edit from quietly
     * reaching into a response shape it has not checked.
     */
    return next.handle().pipe(
      mergeMap((data: unknown) =>
        from(
          this.auditService.record({
            userId: user?.sub,
            action: customAction ?? this.inferAction(method, request),
            entity: this.inferEntity(request),
            ipAddress: auditContext.ipAddress,
            userAgent: auditContext.userAgent,
            metadata: {
              email: auditContext.actorEmail,
              method,
              path: request.originalUrl ?? request.url,
            },
          }),
        ).pipe(map(() => data)),
      ),
    );
  }

  private inferAction(method: string, request: Request): string {
    // `request.route` is untyped in @types/express and is absent entirely on a
    // 404 or a request that never reached a handler. Narrow rather than assert:
    // the audit log must not be the thing that throws.
    const route: unknown = (request as { route?: unknown }).route;
    const routePath =
      typeof route === 'object' &&
      route !== null &&
      typeof (route as { path?: unknown }).path === 'string'
        ? (route as { path: string }).path
        : undefined;
    return `http:${method}:${routePath ?? request.url}`;
  }

  private inferEntity(request: Request): string | undefined {
    const path = request.originalUrl ?? request.url;

    if (path.startsWith('/auth')) return 'Auth';
    if (path.startsWith('/users')) return 'User';
    if (path.startsWith('/admin')) return 'Admin';

    return undefined;
  }
}
