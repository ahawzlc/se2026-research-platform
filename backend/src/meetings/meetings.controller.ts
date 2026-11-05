import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto, UpdateMeetingDto } from './dto/meeting.dto';
import { ListMeetingsQueryDto } from './dto/meeting-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('会议')
@ApiBearerAuth('bearer')
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post()
  @ApiOperation({
    summary:
      '创建会议（写 meeting_create 与每个参会人的 meeting_attend；会议必须挂在项目下）',
  })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateMeetingDto,
  ) {
    return this.meetings.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: '会议列表（分页；可按项目过滤；仅返回本课题组可见的会议）',
  })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListMeetingsQueryDto,
  ) {
    return this.meetings.list(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '会议详情（含参会人列表）' })
  detail(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.meetings.detail(user.userId, id);
  }

  @Put(':id')
  @ApiOperation({
    summary:
      '更新会议（基本信息 + 参会人全量替换；参会人变化会同步 meeting_attend 埋点）',
  })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateMeetingDto,
  ) {
    return this.meetings.update(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除会议（逻辑删除；不撤销历史埋点）' })
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.meetings.remove(user.userId, id);
  }
}
