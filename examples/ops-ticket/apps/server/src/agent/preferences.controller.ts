import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { PreferencesService } from './preferences.service.js';

@Controller('agent/me/preferences/handover')
@RequirePermission('ticket:report')
export class PreferencesController {
  constructor(private readonly memory: PreferencesService) {}
  @Get()
  async get(@CurrentUser() user: AuthUser) { return { preference: await this.memory.get(user.id) }; }
  @Put()
  write(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.memory.write(user.id, body); }
  @Delete(':revision')
  forget(@CurrentUser() user: AuthUser, @Param('revision', ParseUUIDPipe) revision: string) { return this.memory.forget(user.id, revision); }
}
