import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Health, Readiness } from '@ezerd/contracts';
import { DatabaseService } from './db/database.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  health(): Health {
    return { service: 'ezerd-api', status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<Readiness> {
    try {
      await this.database.checkReady();
      return { status: 'ready', database: 'connected', schema: 'ready' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        message: 'PostgreSQL 연결과 마이그레이션 적용 상태를 확인해주세요.',
      } satisfies Readiness);
    }
  }
}
