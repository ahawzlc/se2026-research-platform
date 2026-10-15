import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { API_PREFIX } from './common/result';
import { enableBigIntJsonSerialization } from './common/bigint';

// Prisma 的 BIGINT 主键是 JS BigInt，直接 JSON 序列化会抛错，
// 统一序列化为字符串（详见 common/bigint.ts 的说明）
enableBigIntJsonSerialization();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // 全局路由前缀：所有业务接口形如 /api/v1/xxx
  app.setGlobalPrefix(API_PREFIX);

  // 参数校验：只接受 DTO 中声明过的字段，多余字段直接报错，防止越权写入
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 统一返回体与全局异常（正常返回由拦截器包装，异常由过滤器接管）
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // 开发期前端通过 vite proxy 访问（同源，走代理时不会触发 CORS）；
  // 这里放开 CORS 便于直连调试。
  // 注意：浏览器规范禁止「通配来源 + 携带凭证」组合，故 origin 为 * 时关闭 credentials。
  const corsOrigin = config.get<string>('CORS_ORIGIN', '*');
  app.enableCors({
    origin: corsOrigin,
    credentials: corsOrigin !== '*',
  });

  // 在线接口文档：/api/v1/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('校园科研项目协作与成果管理平台 API')
    .setDescription(
      '统一返回体 { code, message, data }，code === 0 表示成功。\n' +
        '受保护接口需在右上角 Authorize 中填入 Bearer <token>。',
    )
    .setVersion('0.1')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);

  const port = config.get<number>('APP_PORT', 8080);
  await app.listen(port);
  logger.log(`服务已启动：http://localhost:${port}/${API_PREFIX}`);
  logger.log(`接口文档：http://localhost:${port}/${API_PREFIX}/docs`);
}

void bootstrap();
