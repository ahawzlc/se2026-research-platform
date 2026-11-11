import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AchievementsService } from './achievements.service';
import { CreateAchievementDto } from './dto/achievement.dto';
import { ListAchievementsQueryDto } from './dto/achievement-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('成果')
@ApiBearerAuth('bearer')
@Controller('achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Post()
  @ApiOperation({
    summary:
      '创建成果（写 achievement_submit 埋点；成果必须挂在项目下；可传参与人列表）',
  })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateAchievementDto,
  ) {
    return this.achievements.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: '成果列表（分页；可按项目过滤；仅返回本课题组可见的成果）',
  })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListAchievementsQueryDto,
  ) {
    return this.achievements.list(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '成果详情（含参与人列表）' })
  detail(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.achievements.detail(user.userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除成果（逻辑删除；不撤销历史埋点）' })
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.achievements.remove(user.userId, id);
  }
}
