import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import type { Request } from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1', {
    // /health and the public /webhooks/* endpoints keep their own paths.
    exclude: [
      'health',
      'webhooks/whatsapp/:provider/:tenantKey',
      'webhooks/exotel/:tenantKey',
      'webhooks/leads/:source/:tenantKey',
    ],
  });
  app.use(cookieParser());
  // Capture the raw request body so provider webhook HMAC signatures can be
  // verified over the exact bytes received.
  app.use(
    json({
      verify: (req: Request & { rawBody?: string }, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );
  // Telephony providers (Exotel) post form-encoded call webhooks.
  app.use(urlencoded({ extended: true }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: process.env.APP_URL ?? true, credentials: true });

  // Auto-generated OpenAPI/Swagger surface (PRD §8).
  const config = new DocumentBuilder()
    .setTitle('EstateFlow API')
    .setDescription('AI WhatsApp CRM for Real Estate')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`EstateFlow API listening on http://localhost:${port}`);
}

void bootstrap();
