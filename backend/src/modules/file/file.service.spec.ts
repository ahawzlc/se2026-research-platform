import { resolve as pathResolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { FileService } from './file.service';
import { PrismaService } from '../../prisma/prisma.service';

/** 合法的 UUID 字符串，用于 mock 返回值，保证能通过 URL 正则 */
const MOCK_UUID = '123e4567-e89b-12d3-a456-426614174000';

function createService(overrides: Record<string, string> = {}) {
  const config = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const map: Record<string, string> = {
        UPLOAD_DIR: '/tmp/se2026-uploads-test',
        UPLOAD_URL_PREFIX: '/api/v1/files',
        UPLOAD_MAX_SIZE_MB: '1',
        UPLOAD_ALLOWED_EXT: 'pdf,txt',
        ...overrides,
      };
      return map[key] ?? defaultValue;
    }),
  };
  const prisma = {
    file: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const service = new FileService(
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
  );
  return { service, prisma };
}

function buildMulterFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: '论文.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('test'),
    destination: '',
    filename: '',
    path: '',
    stream: null as never,
    ...overrides,
  };
}

describe('FileService.save', () => {
  it('扩展名不在白名单 → 400', async () => {
    const { service, prisma } = createService();
    await expect(
      service.save(buildMulterFile({ originalname: 'virus.exe' }), '1'),
    ).rejects.toMatchObject({ code: 400, message: '不支持的文件类型' });
    expect(prisma.file.create).not.toHaveBeenCalled();
  });

  it('大小超过限制 → 400', async () => {
    const { service, prisma } = createService();
    await expect(
      service.save(buildMulterFile({ size: 2 * 1024 * 1024 }), '1'),
    ).rejects.toMatchObject({ code: 400 });
    expect(prisma.file.create).not.toHaveBeenCalled();
  });

  it('正常上传：UUID 重写文件名、写库、返回字符串 id 与 size', async () => {
    const { service, prisma } = createService();
    prisma.file.create.mockResolvedValue({
      id: 9n,
      originalName: '论文.pdf',
      url: `/api/v1/files/2026/11/02/${MOCK_UUID}.pdf`,
      size: 1024n,
      mimeType: 'application/pdf',
      createdAt: new Date('2026-11-02T14:00:00Z'),
    });

    const result = await service.save(buildMulterFile(), '1');

    expect(result.id).toBe('9');
    expect(result.size).toBe('1024');
    expect(result.url).toMatch(
      /^\/api\/v1\/files\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9-]+\.pdf$/,
    );
    expect(result.createdAt).toBe('2026-11-02 22:00:00');

    // mock.calls 是 any，显式断言成已知形状，避免 no-unsafe-member-access
    const createCalls = prisma.file.create.mock.calls as unknown as Array<
      [{ data: { storedPath: string; originalName: string } }]
    >;
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][0].data.storedPath).toMatch(
      /^\d{4}\/\d{2}\/\d{2}\/[a-f0-9-]+\.pdf$/,
    );
    expect(createCalls[0][0].data.originalName).toBe('论文.pdf');
  });
});

describe('FileService.getDownloadInfo', () => {
  it('库里没有记录 → 404', async () => {
    const { service, prisma } = createService();
    prisma.file.findFirst.mockResolvedValue(null);
    await expect(
      service.getDownloadInfo('2026', '11', '02', `${MOCK_UUID}.pdf`),
    ).rejects.toMatchObject({ code: 404 });
  });

  it('正常返回绝对路径、MIME 与原始文件名', async () => {
    const { service, prisma } = createService();
    prisma.file.findFirst.mockResolvedValue({
      storedPath: `2026/11/02/${MOCK_UUID}.pdf`,
      mimeType: 'application/pdf',
      originalName: '论文.pdf',
    });
    const info = await service.getDownloadInfo(
      '2026',
      '11',
      '02',
      `${MOCK_UUID}.pdf`,
    );
    // 期望值同样用 resolve 构造，避免硬编码 POSIX 路径导致 Windows 下失败
    expect(info.absolutePath).toBe(
      pathResolve('/tmp/se2026-uploads-test', `2026/11/02/${MOCK_UUID}.pdf`),
    );
    expect(info.mimeType).toBe('application/pdf');
    expect(info.originalName).toBe('论文.pdf');
  });
});
