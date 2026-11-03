import { Module } from '@nestjs/common';
import { FileController } from './file.controller';
import { FileService } from './file.service';

/** 文件上传模块（C-4）；PrismaService 为全局模块，无需显式导入 */
@Module({
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
