import { Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 邀请码字母表：大写字母与数字，去掉易混淆的 I / L / O / 0 / 1。
 * 与生成端（teams.service.ts）保持一致。
 */
export const INVITE_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{8}$/;

/** 凭邀请码入组入参 */
export class JoinTeamDto {
  @ApiProperty({
    description: '8 位邀请码（不含易混淆字符）',
    example: 'A3BK7QXR',
  })
  @Matches(INVITE_CODE_PATTERN, { message: '邀请码格式不正确' })
  inviteCode!: string;
}
