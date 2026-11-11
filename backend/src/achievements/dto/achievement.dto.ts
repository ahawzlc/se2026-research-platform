import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 成果类型（docs/02 achievement.type） */
export const ACHIEVEMENT_TYPES = [
  'paper',
  'patent',
  'software',
  'award',
  'other',
] as const;
export type AchievementType = (typeof ACHIEVEMENT_TYPES)[number];

/** 成果成员入参 */
export class AchievementMemberDto {
  @ApiProperty({ description: '参与人 userId（必须是本课题组成员）' })
  @IsString()
  @IsNotEmpty({ message: 'userId 不能为空' })
  userId!: string;

  @ApiPropertyOptional({
    description: '本人贡献说明（仅展示，不参与任何计算），最长 255 个字符',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: '贡献说明最长 255 个字符' })
  contributionNote?: string;
}

/** 创建成果入参 */
export class CreateAchievementDto {
  @ApiProperty({ description: '所属项目 id（成果必须挂在项目下）' })
  @IsString()
  @IsNotEmpty({ message: 'projectId 不能为空' })
  projectId!: string;

  @ApiProperty({ description: '成果类型', enum: ACHIEVEMENT_TYPES })
  @IsIn(ACHIEVEMENT_TYPES, { message: 'type 取值非法' })
  type!: AchievementType;

  @ApiProperty({ description: '成果名称：1-300 个字符' })
  @IsString()
  @IsNotEmpty({ message: '成果名称不能为空' })
  @MaxLength(300, { message: '成果名称最长 300 个字符' })
  title!: string;

  @ApiPropertyOptional({ description: '成果说明（可选）' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '附件 file.id（可选，走 C-4 上传接口）' })
  @IsOptional()
  @IsString()
  fileId?: string;

  @ApiPropertyOptional({
    description: '参与人列表，最多 50 人；成员必须是本课题组成员',
    type: [AchievementMemberDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AchievementMemberDto)
  members?: AchievementMemberDto[];
}
