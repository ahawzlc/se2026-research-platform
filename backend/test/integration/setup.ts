/**
 * 真库集成测试公共装配（卡 T-1a，线①；T-1b/c 各线照此复用）。
 *
 * 与 e2e（mock Prisma）的本质区别：这里【不 override 任何 Provider】，
 * AppModule 连接真实 MySQL——SQL 行为、唯一约束、逻辑删除全部真实生效。
 *
 * 运行方式：
 *   - CI：deploy.yml 的「真库集成测试」job（services.mysql + 01-schema.sql 重放 + 本套件）；
 *   - 本地：自备 MySQL（docker 或服务器隔离库），设 `RUN_INTEGRATION=1` 与
 *     `DATABASE_URL=mysql://...` 后 `cd backend && npm run test:integration`；
 *   - 未设 RUN_INTEGRATION 时整组跳过，不影响 `npm test` / `npm run test:e2e`。
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { API_PREFIX } from '../../src/common/result';

export const INTEGRATION_ON = process.env.RUN_INTEGRATION === '1';

/** 未开开关时整组跳过（本地无库环境友好） */
export const maybe = INTEGRATION_ON ? describe : describe.skip;

/** 每次运行的时间戳后缀，隔离注册数据，避免逻辑删除/唯一键占位互相干扰 */
export const RUN = Date.now().toString(36);

export interface Envelope<T> {
  code: number;
  message: string;
  data: T | null;
}

export function envelope<T>(res: { body: unknown }): Envelope<T> {
  return res.body as Envelope<T>;
}

/** 与 main.ts 等价的装配（前缀/管道/拦截器/过滤器），不 mock 任何 Provider */
export async function createIntegrationApp(): Promise<INestApplication<App>> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

/** 注册一个测试用户并返回 { token, userId, username }（注册即登录） */
export async function registerUser(
  app: INestApplication<App>,
  username: string,
): Promise<{ token: string; userId: string; username: string }> {
  const res = await request(app.getHttpServer())
    .post(`/${API_PREFIX}/auth/register`)
    .send({
      username,
      password: 'Passw0rd!2026',
      nickname: `测试-${username}`,
      email: `${username}@t.local`,
    })
    .expect(201);
  const body = envelope<{
    token: string;
    user: { id: string; username: string };
  }>(res);
  if (body.code !== 0 || !body.data) {
    throw new Error(`注册失败：${JSON.stringify(body)}`);
  }
  return { token: body.data.token, userId: body.data.user.id, username };
}
