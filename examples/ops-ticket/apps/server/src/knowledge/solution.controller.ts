import { Body, Get, Controller, Param, Post, Req } from '@nestjs/common';
import { IsInt, IsString, Length, Min } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { SolutionService } from './solution.service.js';

class DraftDto {
  @IsString() @Length(1,120) title!:string;
  @IsString() @Length(1,4000) body!:string;
}
class VersionDto { @IsInt() @Min(1) version!:number; }

@RequirePermission('knowledge:approve')
@Controller('knowledge')
export class SolutionController {
  constructor(private readonly solutions:SolutionService) {}
  @Post('tickets/:ticketNo/draft')
  draft(@Req() req:AuthenticatedRequest,@Param('ticketNo') no:string,@Body() dto:DraftDto) {
    return this.solutions.draft(req.user!.id,no,dto.title,dto.body);
  }
  @Get('reviews')
  queue(@Req() req:AuthenticatedRequest) {return this.solutions.reviewQueue(req.user!.id);}

  @Post(':id/reject')
  reject(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() dto:VersionDto) {
    return this.solutions.reject(req.user!.id,id,dto.version);
  }

  @Post(':id/approve')
  approve(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() dto:VersionDto) {
    return this.solutions.approve(req.user!.id,id,dto.version);
  }

  @Post(':id/publish')
  publish(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() dto:VersionDto) {
    return this.solutions.publish(req.user!.id,id,dto.version);
  }
}
