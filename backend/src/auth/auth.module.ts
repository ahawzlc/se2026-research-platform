import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RateLimitService } from './rate-limit.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-only-insecure-secret',
        signOptions: {
          expiresIn: Number(
            config.get<string>('JWT_EXPIRES_IN_SECONDS', '604800'),
          ),
        },
      }),
    }),
    // 注册时分配对外 UID（线③ 卡 E-3）
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RateLimitService],
  exports: [AuthService],
})
export class AuthModule {}
