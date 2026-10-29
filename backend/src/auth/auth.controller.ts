import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { DevTokenDto } from './dto/dev-token.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
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
  @Post('register')
  @ApiOperation({ summary: '注册（注册即登录，直接返回令牌与用户信息）' })
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: '登录，返回令牌与用户信息' })
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @ApiOperation({ summary: '获取当前登录用户（查库返回，含格式化注册时间）' })
  me(@CurrentUser() user: CurrentUserPayload) {
    return this.auth.me(user.userId);
  }

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

  private isDevTokenEnabled(): boolean {
    return this.config.get<string>('APP_ENABLE_DEV_TOKEN', 'true') !== 'false';
  }
}
