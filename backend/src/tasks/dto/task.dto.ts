import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 看板三列（docs/02 task.status） */
export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 任务优先级 */
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** 任务列表查询参数 */
export class ListTasksQueryDto {
  @ApiPropertyOptional({ description: '按项目过滤' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: '按状态过滤', enum: TASK_STATUSES })
  @IsOptional()
  @IsIn(TASK_STATUSES, { message: 'status 取值非法' })
  status?: TaskStatus;

  @ApiPropertyOptional({ description: '按负责人过滤' })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({
    description: '只看我负责的任务',
    example: 'true',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsString()
  mine?: string;

  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 需为整数' })
  @Min(1, { message: 'page 最小为 1' })
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页条数，上限 100', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size 需为整数' })
  @Min(1, { message: 'size 最小为 1' })
  @Max(100, { message: 'size 最大为 100' })
  size?: number = 50;
}

/** 创建任务入参 */
export class CreateTaskDto {
  @ApiProperty({ description: '所属项目 id' })
  @IsString()
  @IsNotEmpty({ message: 'projectId 不能为空' })
  projectId!: string;

  @ApiProperty({ description: '任务标题：1-200 个字符' })
  @IsString()
  @IsNotEmpty({ message: '任务标题不能为空' })
  @MaxLength(200, { message: '任务标题最长 200 个字符' })
  title!: string;

  @ApiPropertyOptional({ description: '任务描述（可选）' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '负责人 id；不传表示待认领' })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({
    description: '优先级',
    enum: TASK_PRIORITIES,
    default: 'medium',
  })
  @IsOptional()
  @IsIn(TASK_PRIORITIES, { message: 'priority 取值非法' })
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: '截止日期 yyyy-MM-dd' })
  @IsOptional()
  @IsDateString({}, { message: 'dueDate 需为 yyyy-MM-dd 格式的日期' })
  dueDate?: string;

  @ApiPropertyOptional({
    description: '初始状态',
    enum: TASK_STATUSES,
    default: 'todo',
  })
  @IsOptional()
  @IsIn(TASK_STATUSES, { message: 'status 取值非法' })
  status?: TaskStatus;
}

/** 更新任务入参；全部字段可选 */
export class UpdateTaskDto {
  @ApiPropertyOptional({ description: '任务标题' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '任务标题不能为空' })
  @MaxLength(200, { message: '任务标题最长 200 个字符' })
  title?: string;

  @ApiPropertyOptional({ description: '任务描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '负责人 id；传空字符串表示取消指派' })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({ description: '优先级', enum: TASK_PRIORITIES })
  @IsOptional()
  @IsIn(TASK_PRIORITIES, { message: 'priority 取值非法' })
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: '截止日期 yyyy-MM-dd' })
  @IsOptional()
  @IsDateString({}, { message: 'dueDate 需为 yyyy-MM-dd 格式的日期' })
  dueDate?: string;
}

/** 状态流转入参（看板换列） */
export class UpdateTaskStatusDto {
  @ApiProperty({ description: '目标状态', enum: TASK_STATUSES })
  @IsIn(TASK_STATUSES, { message: 'status 取值非法' })
  status!: TaskStatus;
}

/**
 * 排序入参（看板列内拖拽）。
 *
 * 约定（docs/02 待确认项第 2 条，由 B 组定）：sort_order 用**整数间隔**，
 * 取 100、200、300……插入时取前后两项的中值。这样单次拖拽只需写一行，
 * 不必重排整列。
 */
export class UpdateTaskOrderDto {
  @ApiProperty({
    description: '目标列的排在前一个任务的 sort_order（拖到列首时传 null）',
    nullable: true,
    example: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'beforeSortOrder 需为整数' })
  beforeSortOrder?: number | null;

  @ApiPropertyOptional({
    description: '目标列的排在后一个任务的 sort_order；与上一个参数二选一',
    nullable: true,
    example: 300,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'afterSortOrder 需为整数' })
  afterSortOrder?: number | null;
}
