import { RequirePermission } from '../auth/permissions.decorator.js';
import { BadRequestException, Body, Controller, ForbiddenException, Param, Post, Req } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from './password.js';
import { Public } from './public.decorator.js';
import type { AuthenticatedRequest } from './auth.types.js';

class RegisterDto {
  @IsString() @Length(1,64) username!:string;
  @IsString() @Length(8,128) password!:string;
  @IsString() company!:string;
}
@Controller('registrations')
export class RegistrationsController {
  constructor(private readonly db:PrismaService) {}
  @Public() @Post()
  async register(@Body() dto:RegisterDto) {
    const company=await this.db.company.findUnique({where:{name:dto.company}});
    if (!company) throw new BadRequestException('客户公司不存在');
    return this.db.user.create({data:{
      username:dto.username,displayName:dto.username,passwordHash:await hashPassword(dto.password),
      companyId:company.id,role:'reporter',registrationStatus:'pending',
    },select:{id:true,registrationStatus:true}});
  }
  @RequirePermission('registration:approve')
@Post(':id/approve')
  async approve(@Req() req:AuthenticatedRequest,@Param('id') id:string) {
    const admin=await this.db.user.findFirst({where:{id:req.user!.id,role:'customer_admin',registrationStatus:'approved'}});
    if (!admin?.companyId) throw new ForbiddenException();
    await this.db.$transaction(async tx=>{
    const changed=await tx.user.updateMany({where:{id,role:'reporter',companyId:admin.companyId,registrationStatus:'pending'},
      data:{registrationStatus:'approved'}});
    if (!changed.count) throw new BadRequestException('本公司没有这项待审申请');
      await tx.registrationAudit.create({data:{companyId:admin.companyId!,approverId:admin.id,applicantId:id}});
    });
    return {approved:true};
  }
}
