import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/** 契约双前缀：/api/v1（小程序）与 /admin/v1（管理端）。admin 控制器自带 'admin' 段，需排除全局前缀 */
export const GLOBAL_PREFIX_OPTIONS = {
  exclude: [{ path: 'admin/(.*)', method: RequestMethod.ALL }],
} as const;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'admin/(.*)', method: RequestMethod.ALL }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: true }); // H5 预览（:5173）直连 API；生产由网关控制
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}
void bootstrap();
