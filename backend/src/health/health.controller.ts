import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('系统')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '健康检查（含数据库连通性）' })
  async health() {
    return {
      service: 'se2026-backend',
      status: 'up',
      time: new Date().toISOString(),
      database: (await this.prisma.ping()) ? 'connected' : 'disconnected',
    };
  }
}
