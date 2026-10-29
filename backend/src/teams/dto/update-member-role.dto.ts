import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 可分配的角色。owner 只随建组产生，不通过本接口修改
 * （组长转让属于后续「退出与交接」故事，不在本卡范围）。
 */
export class UpdateMemberRoleDto {
  @ApiProperty({ description: '目标角色', enum: ['admin', 'member'] })
  @IsIn(['admin', 'member'], { message: '角色只能是 admin 或 member' })
  role!: 'admin' | 'member';
}
