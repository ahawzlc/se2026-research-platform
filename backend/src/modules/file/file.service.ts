import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { BizException } from '../../common/result';
import { formatDate, formatDateTime, toIdString } from '../../common/datetime';
import { DEFAULT_ALLOWED_EXT, DEFAULT_MAX_SIZE_MB } from './file.constants';

/**
 * 纠正上传文件名的字符编码。
 *
 * **为什么需要**：浏览器按 UTF-8 发送 multipart 的 filename，
 * 但 multer/busboy 默认用 latin1 解析 header，
 * 于是中文名会被解成乱码（"纪要.txt" → "çºªè¦.txt"）——
 * **存进库的文件名是乱的，下发给用户看到的也是乱的**。
 *
 * 注意：乱码**不影响扩展名**——扩展名是 ASCII（`.txt`），latin1 解码不变，
 * 所以扩展名白名单校验一直是有效的。此前文档里「乱码会让白名单失效」
 * 的说法不准确，已更正。
 *
 * 做法：把 latin1 串**按字节**还原成 UTF-8。
 * 若还原结果含替换字符（说明原串本就不是「UTF-8 被误读成 latin1」），保持原样。
 *
 * 现在 controller 已用 `defParamCharset: 'utf8'` 从源头解决，
 * 本函数作为**兜底**保留：万一有客户端仍按 latin1 发送，还能救回来。
 */
export function decodeOriginalName(name: string): string {
  if (!name) return name;
  // 纯 ASCII 之类不含高位字节的名字无需处理
  if (!/[\u00c0-\u00ff]/.test(name)) {
    return name;
  }
  const bytes = Buffer.from(name, 'latin1');
  const decoded = bytes.toString('utf8');
  return decoded.includes('\ufffd') ? name : decoded;
}

/** 上传成功后返回给前端的文件信息（与 frontend/src/api/types.ts 的 FileItem 对齐） */
export interface FileItem {
  id: string;
  originalName: string;
  url: string;
  size: string;
  mimeType: string;
  createdAt: string;
}

/** 下载时需要的落盘信息 */
export interface FileDownloadInfo {
  absolutePath: string;
  mimeType: string;
  originalName: string;
}

@Injectable()
export class FileService {
  private readonly uploadDir: string;
  private readonly urlPrefix: string;
  private readonly maxSizeBytes: number;
  private readonly allowedExt: Set<string>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.uploadDir = resolve(
      this.config.get<string>('UPLOAD_DIR', './uploads'),
    );
    this.urlPrefix = this.config.get<string>(
      'UPLOAD_URL_PREFIX',
      '/api/v1/files',
    );
    const maxMb = Number(
      this.config.get<string>(
        'UPLOAD_MAX_SIZE_MB',
        String(DEFAULT_MAX_SIZE_MB),
      ),
    );
    this.maxSizeBytes = maxMb * 1024 * 1024;
    const extStr = this.config.get<string>(
      'UPLOAD_ALLOWED_EXT',
      DEFAULT_ALLOWED_EXT,
    );
    this.allowedExt = new Set(
      extStr
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
        .map((e) => `.${e}`),
    );
  }

  get maxSize(): number {
    return this.maxSizeBytes;
  }

  isAllowedExt(filename: string): boolean {
    return this.allowedExt.has(extname(filename).toLowerCase());
  }

  /**
   * 保存上传文件：校验 → UUID 重写文件名 → 按日期分目录落盘 → 写 file 表。
   * 不写 activity_log（红线 8：ActivityType 固定 9 类，没有 file_upload）。
   */
  async save(file: Express.Multer.File, uploaderId: string): Promise<FileItem> {
    if (file.size > this.maxSizeBytes) {
      throw BizException.param(
        `文件大小超过 ${this.maxSizeBytes / 1024 / 1024}MB 限制`,
      );
    }
    // 中文文件名先纠正编码（见 decodeOriginalName）
    const originalName = decodeOriginalName(file.originalname);
    if (!this.isAllowedExt(originalName)) {
      throw BizException.param('不支持的文件类型');
    }

    const ext = extname(originalName).toLowerCase();
    const filename = `${randomUUID()}${ext}`;
    const dateDir = formatDate(new Date()).replace(/-/g, '/');
    const storedPath = `${dateDir}/${filename}`;
    const absoluteDir = join(this.uploadDir, dateDir);
    const absolutePath = join(this.uploadDir, storedPath);

    await mkdir(absoluteDir, { recursive: true });
    await writeFile(absolutePath, file.buffer);

    const record = await this.prisma.file.create({
      data: {
        uploaderId: BigInt(uploaderId),
        originalName,
        storedPath,
        url: `${this.urlPrefix}/${storedPath}`,
        size: BigInt(file.size),
        mimeType: file.mimetype,
      },
    });

    return this.toFileItem(record);
  }

  /**
   * 下载前查库拿 MIME 与原始文件名，并做路径穿越校验。
   * 文件不存在或路径非法统一 404，不泄露内部结构。
   */
  async getDownloadInfo(
    year: string,
    month: string,
    day: string,
    filename: string,
  ): Promise<FileDownloadInfo> {
    const storedPath = `${year}/${month}/${day}/${filename}`;
    const record = await this.prisma.file.findFirst({
      where: { storedPath, deleted: 0 },
    });
    if (!record) {
      throw BizException.notFound('文件不存在');
    }
    const absolutePath = resolve(join(this.uploadDir, storedPath));
    // 跨平台安全校验：解析后的路径必须仍在上传根目录内
    const rel = relative(this.uploadDir, absolutePath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw BizException.notFound('文件不存在');
    }
    return {
      absolutePath,
      mimeType: record.mimeType ?? 'application/octet-stream',
      originalName: record.originalName,
    };
  }

  /** 下载前确认文件确实在磁盘上，避免库里有记录但文件已丢 */
  async assertFileExists(absolutePath: string): Promise<void> {
    try {
      await access(absolutePath);
    } catch {
      throw BizException.notFound('文件不存在');
    }
  }

  private toFileItem(record: {
    id: bigint;
    originalName: string;
    url: string | null;
    size: bigint;
    mimeType: string | null;
    createdAt: Date;
  }): FileItem {
    return {
      id: toIdString(record.id),
      originalName: record.originalName,
      url: record.url ?? '',
      size: record.size.toString(),
      mimeType: record.mimeType ?? '',
      createdAt: formatDateTime(record.createdAt),
    };
  }
}
