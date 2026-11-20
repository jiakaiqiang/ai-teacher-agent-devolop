import { RequirePermission } from '../auth/permissions.decorator.js';
import { Controller, Get, Delete, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}
  @RequirePermission('ticket:report')
  @Get()
  list(){return this.prisma.category.findMany({select:{name:true},orderBy:{name:'asc'}});}
  @RequirePermission('ticket:assign')
  @Delete(':name')
  remove(@Param('name') name: string) {
    return this.prisma.category.delete({ where: { name }, select: { name: true } });
  }
}
