import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { API_PREFIX } from './../src/common/result';

/** 统一返回体形状，避免在测试里到处出现 any */
interface Envelope<T> {
  code: number;
  message: string;
  data: T | null;
}

function envelope<T>(res: { body: unknown }): Envelope<T> {
  return res.body as Envelope<T>;
}

interface TokenData {
  token: string;
  tokenType: string;
  expiresIn: number;
}

interface MeData {
  userId: string;
  username: string;
  roles: string[];
}

/**
 * 底座冒烟测试：验证统一返回体、全局前缀、鉴权链路与参数校验是否生效。
 * 不依赖数据库连接。
 */
describe('底座 (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
  });

  afterAll(async () => {
    await app.close();
  });

  it(`GET /${API_PREFIX}/health 返回统一返回体且 code 为 0`, async () => {
    const res = await request(app.getHttpServer())
      .get(`/${API_PREFIX}/health`)
      .expect(200);
    const body = envelope<{ service: string; status: string }>(res);
    expect(body.code).toBe(0);
    expect(body.message).toBe('ok');
    expect(body.data?.service).toBe('se2026-backend');
    expect(body.data?.status).toBe('up');
  });

  it('未登录访问受保护接口返回 401 与业务错误码', async () => {
    const res = await request(app.getHttpServer())
      .get(`/${API_PREFIX}/auth/me`)
      .expect(401);
    const body = envelope<null>(res);
    expect(body.code).toBe(401);
    expect(body.data).toBeNull();
  });

  it('开发令牌可换取令牌，并能通过鉴权访问受保护接口', async () => {
    const tokenRes = await request(app.getHttpServer())
      .post(`/${API_PREFIX}/auth/dev-token`)
      .send({ userId: '1', username: 'demo' })
      .expect(201);
    const tokenBody = envelope<TokenData>(tokenRes);
    expect(tokenBody.code).toBe(0);
    const token = tokenBody.data?.token ?? '';
    expect(token.length).toBeGreaterThan(0);

    const meRes = await request(app.getHttpServer())
      .get(`/${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const meBody = envelope<MeData>(meRes);
    expect(meBody.code).toBe(0);
    expect(meBody.data?.userId).toBe('1');
    expect(meBody.data?.username).toBe('demo');
  });

  it('非法 token 被拒绝', async () => {
    const res = await request(app.getHttpServer())
      .get(`/${API_PREFIX}/auth/me`)
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
    expect(envelope<null>(res).code).toBe(401);
  });

  it('DTO 校验拦截多余字段', async () => {
    const res = await request(app.getHttpServer())
      .post(`/${API_PREFIX}/auth/dev-token`)
      .send({ userId: '1', unexpected: 'x' })
      .expect(400);
    expect(envelope<null>(res).code).toBe(400);
  });
});
