import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { StatsService } from './stats.service';
import { StatsQuery, DetailsQuery } from './stats.query';

@ApiTags('参与度分析')
@ApiBearerAuth('bearer')
@Controller('stats/contribution')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  @ApiOperation({ summary: '团队参与度快照与周趋势' })
  summary(@CurrentUser() user: CurrentUserPayload, @Query() query: StatsQuery) {
    return this.stats.summary(user.userId, query.teamId);
  }

  @Get('details')
  @ApiOperation({ summary: '参与度行为明细与计入原因' })
  details(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: DetailsQuery,
  ) {
    return this.stats.details(user.userId, query);
  }
}
