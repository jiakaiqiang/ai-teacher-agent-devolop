import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service.js';

export async function bearer(app:INestApplication, username='lin') {
  const user=await app.get(PrismaService).user.findUniqueOrThrow({where:{username}});
  return 'Bearer '+await app.get(JwtService).signAsync({sub:user.id,username});
}
