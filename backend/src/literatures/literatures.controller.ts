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
import { LiteraturesService } from './literatures.service';
import {
  CreateLiteratureDto,
  UpdateLiteratureDto,
  UpdateReadStatusDto,
} from './dto/literature.dto';
import { ListLiteraturesQueryDto } from './dto/literature-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('文献')
@ApiBearerAuth('bearer')
@Controller('literatures')
export class LiteraturesController {
  constructor(private readonly literatures: LiteraturesService) {}

  @Post()
  @ApiOperation({
    summary: '创建文献（写 literature_upload 埋点；附件与外链至少一个）',
  })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateLiteratureDto,
  ) {
    return this.literatures.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: '文献列表（分页，仅本课题组可见；可按标签、阅读状态过滤）',
  })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListLiteraturesQueryDto,
  ) {
    return this.literatures.list(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '文献详情' })
  detail(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.literatures.detail(user.userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新文献（标题、项目、附件、外链、标签）' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateLiteratureDto,
  ) {
    return this.literatures.update(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除文献（逻辑删除）' })
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.literatures.remove(user.userId, id);
  }

  @Put(':id/read-status')
  @ApiOperation({
    summary:
      '更新阅读状态（变为 read 时写 literature_read；同一文献只计一次，单日上限 5）',
  })
  updateReadStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateReadStatusDto,
  ) {
    return this.literatures.updateReadStatus(user.userId, id, dto);
  }
}
