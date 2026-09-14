import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { MongoService } from '../mongo/mongo.service';
import { Public } from '../modules/auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Health for whatever sits in front of the API — a load balancer, SAE/ACK probes, Caddy, a
 * human with curl.
 *
 * Two endpoints because they answer two different questions. `/health` says "the process is
 * up"; it must never touch a dependency, or a database blip makes the orchestrator restart a
 * perfectly good process. `/health/ready` says "this instance can serve traffic": Postgres
 * answers and Mongo answers. A load balancer should route on the second and restart on the
 * first. Neither leaks anything but a boolean per dependency, and both are exempt from the
 * rate limiter, because a probe every few seconds from several addresses is exactly the
 * traffic a limiter would otherwise cut off.
 */
@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Liveness: the process is up. Touches nothing.' })
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get('ready')
  @Public()
  @ApiOperation({
    summary:
      'Readiness: Postgres and MongoDB answer. 503 when either does not.',
  })
  async ready() {
    // A dependency that hangs is as unavailable as one that refuses, and a probe must answer
    // inside the balancer's own timeout — the Mongo driver would otherwise wait 30 s for
    // server selection. Three seconds, then it is a "no".
    const within = (p: Promise<unknown>, ms = 3_000) =>
      Promise.race([
        p.then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), ms).unref(),
        ),
      ]);
    const [postgres, mongo] = await Promise.all([
      within(this.prisma.$queryRaw`SELECT 1`),
      within(this.mongo.getDb().command({ ping: 1 })),
    ]);
    const body = {
      status: postgres && mongo ? 'ok' : 'degraded',
      postgres,
      mongo,
    };
    if (!postgres || !mongo) throw new ServiceUnavailableException(body);
    return body;
  }
}
