import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import {
  createMessageSchema,
  createThreadSchema,
  deleteThreadSchema,
  updateNotificationSchema,
  updateThreadSchema,
} from '@ezerd/contracts';
import { ReviewService } from './review.service.js';
import { requireSession, SessionService } from '../identity/session.js';

const idSchema = z.uuid();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('입력값을 확인해주세요.');
  return result.data;
}

@Controller()
export class ReviewController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ReviewService) private readonly reviews: ReviewService,
  ) {}

  @Get('projects/:projectId/threads')
  list(@Param('projectId') rawId: string) {
    return this.reviews.list(parse(idSchema, rawId));
  }

  @Post('projects/:projectId/threads')
  async create(
    @Headers('authorization') authorization: string | undefined,
    @Param('projectId') rawId: string,
    @Body() body: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    return this.reviews.create(parse(idSchema, rawId), parse(createThreadSchema, body), actor);
  }

  @Delete('threads/:id')
  async remove(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    return this.reviews.remove(parse(idSchema, rawId), parse(deleteThreadSchema, body), actor);
  }

  @Post('threads/:id/messages')
  async reply(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    return this.reviews.reply(parse(idSchema, rawId), parse(createMessageSchema, body), actor);
  }

  @Patch('threads/:id')
  async update(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    return this.reviews.update(parse(idSchema, rawId), parse(updateThreadSchema, body), actor);
  }

  @Get('users/:id/notifications')
  listNotifications(@Param('id') rawId: string) {
    return this.reviews.listNotifications(parse(idSchema, rawId));
  }

  @Patch('notifications/:id')
  async updateNotification(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    return this.reviews.updateNotification(
      parse(idSchema, rawId),
      parse(updateNotificationSchema, body),
      actor,
    );
  }
}
