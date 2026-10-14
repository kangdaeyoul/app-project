import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.useBodyParser('json', { limit: '10mb' });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4000), process.env.HOST ?? '0.0.0.0');
}
bootstrap().catch(error => { console.error(error); process.exit(1); });
