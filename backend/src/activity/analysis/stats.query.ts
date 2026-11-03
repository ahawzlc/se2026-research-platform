import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DIMENSIONS } from './participation';

export class StatsQuery {
  @ApiProperty({ description: '课题组 id（字符串）' })
  @Matches(/^[1-9][0-9]{0,19}$/, { message: 'teamId 需为正整数字符串' })
  teamId!: string;
}
export class DetailsQuery extends StatsQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9][0-9]{0,19}$/)
  userId?: string;

  @ApiPropertyOptional({ enum: DIMENSIONS.map((d) => d.key) })
  @IsOptional()
  @IsIn(DIMENSIONS.map((d) => d.key))
  dimension?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size: number = 10;
}
