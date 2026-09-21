import { HttpException, Injectable } from '@nestjs/common';

type Window = { count: number; resetAt: number };

@Injectable()
export class RateLimitService {
  private readonly windows = new Map<string, Window>();

  consume(key: string, limit: number, durationMs: number): void {
    const now = Date.now();
    if (this.windows.size >= 10_000) {
      for (const [entryKey, value] of this.windows)
        if (value.resetAt <= now) this.windows.delete(entryKey);
      if (this.windows.size >= 10_000 && !this.windows.has(key))
        throw new HttpException('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429);
    }
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + durationMs });
      return;
    }
    if (current.count >= limit)
      throw new HttpException('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429);
    current.count += 1;
  }
}
