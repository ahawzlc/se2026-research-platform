import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityService } from './activity.service';
import { ActivityLogInterceptor } from './activity-log.interceptor';

/**
 * 埋点模块（全局）。
 *
 * 注册为全局拦截器后，任何控制器方法只要加上 @ActivityLog({...})
 * 就会在成功返回后自动写入 activity_log；未标注的方法不产生埋点。
 */
@Global()
@Module({
  providers: [
    ActivityService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ActivityLogInterceptor,
    },
  ],
  exports: [ActivityService],
})
export class ActivityModule {}
