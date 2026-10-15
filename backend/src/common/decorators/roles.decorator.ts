import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * 声明访问接口所需的角色（课题组内的角色，取值 owner / admin / member）。
 *
 * 说明：角色是**课题组维度**的（同一用户在不同课题组角色可能不同），
 * 这里的守卫只做令牌载荷层面的粗粒度校验。涉及具体团队数据的接口，
 * 必须在 service 层查 team_member 复核，防止越权访问他人课题组数据。
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
