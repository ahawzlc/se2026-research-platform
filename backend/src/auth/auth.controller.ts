import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { DevTokenDto } from './dto/dev-token.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('鉴权')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('dev-token')
  @ApiOperation({
    summary: '【开发用】为指定用户签发令牌，便于联调自测；生产环境自动关闭',
  })
  async devToken(@Body() dto: DevTokenDto) {
    if (!this.isDevTokenEnabled()) {
      throw new NotFoundException();
    }
    const token = await this.auth.sign({
      userId: dto.userId,
      username: dto.username ?? `user-${dto.userId}`,
    });
    return {
      token,
      tokenType: 'Bearer',
      expiresIn: this.auth.expiresInSeconds,
    };
  }

  @Get('me')
  @ApiOperation({ summary: '获取当前登录用户的令牌信息（用于验证鉴权链路）' })
  me(@CurrentUser() user: CurrentUserPayload) {
    return user;
  }

  private isDevTokenEnabled(): boolean {
    return this.config.get<string>('APP_ENABLE_DEV_TOKEN', 'true') !== 'false';
  }
}
