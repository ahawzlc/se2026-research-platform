import {
  Controller,
  Get,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import { FileService } from './file.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BizException } from '../../common/result';
import { INTERCEPTOR_MAX_SIZE_MB } from './file.constants';

@ApiTags('文件')
@Controller('files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('upload')
  @ApiOperation({ summary: '统一文件上传，返回文件标识与访问 URL' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: INTERCEPTOR_MAX_SIZE_MB * 1024 * 1024 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (!file) {
      throw BizException.param('请选择要上传的文件');
    }
    return this.fileService.save(file, user.userId);
  }

  @Public()
  @Get(':year/:month/:day/:filename')
  @ApiOperation({
    summary: '访问上传的文件（文件名为 UUID，不可枚举；第一版不做登录校验）',
  })
  async download(
    @Param('year') year: string,
    @Param('month') month: string,
    @Param('day') day: string,
    @Param('filename') filename: string,
  ): Promise<StreamableFile> {
    if (
      !/^\d{4}$/.test(year) ||
      !/^\d{2}$/.test(month) ||
      !/^\d{2}$/.test(day)
    ) {
      throw BizException.notFound('文件不存在');
    }
    if (
      !/^[a-f0-9-]+\.[a-z0-9]+$/i.test(filename) ||
      filename.includes('..') ||
      filename.includes('/')
    ) {
      throw BizException.notFound('文件不存在');
    }
    const { absolutePath, mimeType, originalName } =
      await this.fileService.getDownloadInfo(year, month, day, filename);
    await this.fileService.assertFileExists(absolutePath);
    return new StreamableFile(createReadStream(absolutePath), {
      type: mimeType,
      disposition: `inline; filename="${encodeURIComponent(originalName)}"`,
    });
  }
}
