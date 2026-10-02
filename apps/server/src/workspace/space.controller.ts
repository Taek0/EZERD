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
import {
  createWorkspaceSchema,
  createWorkspaceInvitationSchema,
  updateWorkspaceSchema,
  updateWorkspaceMemberSchema,
} from '@ezerd/contracts';
import { z } from 'zod';
import { requireSession, SessionService } from '../identity/session.js';
import { SpaceService } from './space.service.js';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('입력값을 확인해주세요.');
  return result.data;
}
const id = (value: string) => parse(z.uuid(), value);

@Controller()
export class SpaceController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SpaceService) private readonly spaces: SpaceService,
  ) {}

  private async actor(authorization: string | undefined) {
    return (await requireSession(this.sessions, authorization)).id;
  }

  @Get('workspaces')
  async list(@Headers('authorization') authorization: string | undefined) {
    return this.spaces.listWorkspaces(await this.actor(authorization));
  }

  @Post('workspaces')
  async create(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    return this.spaces.createWorkspace(
      await this.actor(authorization),
      parse(createWorkspaceSchema, body),
    );
  }

  @Get('workspaces/:id')
  async get(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    return this.spaces.getWorkspace(await this.actor(authorization), id(rawId));
  }

  @Patch('workspaces/:id')
  async update(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    return this.spaces.updateWorkspace(
      await this.actor(authorization),
      id(rawId),
      parse(updateWorkspaceSchema, body),
    );
  }

  @Delete('workspaces/:id')
  async delete(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    return this.spaces.deleteWorkspace(await this.actor(authorization), id(rawId));
  }

  @Get('workspaces/:id/members')
  async members(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    return this.spaces.listMembers(await this.actor(authorization), id(rawId));
  }

  @Patch('workspaces/:id/members/:userId')
  async updateMember(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    return this.spaces.updateMember(
      await this.actor(authorization),
      id(rawId),
      id(userId),
      parse(updateWorkspaceMemberSchema, body),
    );
  }

  @Delete('workspaces/:id/members/:userId')
  async removeMember(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Param('userId') userId: string,
  ) {
    return this.spaces.removeMember(await this.actor(authorization), id(rawId), id(userId));
  }

  @Post('workspaces/:id/leave')
  async leave(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    return this.spaces.leaveWorkspace(await this.actor(authorization), id(rawId));
  }

  @Get('workspaces/:id/invitations')
  async invitations(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    return this.spaces.listInvitations(await this.actor(authorization), id(rawId));
  }

  @Post('workspaces/:id/invitations')
  async invite(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    return this.spaces.createInvitation(
      await this.actor(authorization),
      id(rawId),
      parse(createWorkspaceInvitationSchema, body),
    );
  }

  @Post('workspaces/:id/invitations/:invitationId/cancel')
  async cancel(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.spaces.cancelInvitation(
      await this.actor(authorization),
      id(rawId),
      id(invitationId),
    );
  }

  @Get('workspace-invitations')
  async inbox(@Headers('authorization') authorization: string | undefined) {
    return this.spaces.invitationInbox(await this.actor(authorization));
  }

  @Post('workspace-invitations/:id/accept')
  async accept(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    return this.spaces.acceptInvitation(await this.actor(authorization), id(rawId));
  }

  @Post('workspace-invitations/:id/decline')
  async decline(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    return this.spaces.declineInvitation(await this.actor(authorization), id(rawId));
  }
}
