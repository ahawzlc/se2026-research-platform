import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** 全局模块：任何模块注入 PrismaService 都无需再 import */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
