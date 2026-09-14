import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * Allowed browser origins.
 *
 * Read from CORS_ORIGINS (comma-separated) so adding a front end is a deployment change
 * rather than a code change. The defaults are the development ports only — a production
 * origin that is not in the environment does not work, which is the failure you want.
 */
function corsOrigins(config: ConfigService): string[] {
  const raw = config.get<string>('CORS_ORIGINS', '');
  const configured = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;

  // Nothing configured: assume local development and allow only localhost.
  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:5173',
  ];
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  // Behind Caddy in production. Without this, express sees the proxy's IP for every
  // request and per-IP rate limiting protects nobody.
  app.set('trust proxy', 1);

  // Security headers. contentSecurityPolicy is disabled because this process serves an API
  // and the Swagger UI, not application HTML — a CSP here would break the docs page while
  // protecting nothing. The browser front end sets its own CSP at its own origin.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Request size limit. Uploads go to GridFS through their own multipart route; a JSON body
  // larger than this is a mistake or an attack, and the default of 100kb is too small for
  // legitimate listing payloads.
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  app.enableCors({
    origin: corsOrigins(config),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger publishes every endpoint, every DTO and every field name. That is exactly what
  // a developer wants and exactly what an attacker wants, so it is off in production unless
  // somebody turns it on deliberately.
  const docsEnabled =
    !isProduction || config.get<string>('ENABLE_SWAGGER') === 'true';
  if (docsEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('UZA Mobility API')
      .setDescription('Backend API for UZA Mobility')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          in: 'header',
        },
        'JWT-access',
      )
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          in: 'header',
        },
        'JWT-refresh',
      )
      .build();
    SwaggerModule.setup(
      '/api/docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  const port = config.get<number>('PORT', 7000);
  await app.listen(port);

  console.log(`Server listening on http://localhost:${port}`);
  console.log(
    docsEnabled
      ? `Swagger docs: http://localhost:${port}/api/docs`
      : 'Swagger docs: disabled',
  );
}

void bootstrap();
