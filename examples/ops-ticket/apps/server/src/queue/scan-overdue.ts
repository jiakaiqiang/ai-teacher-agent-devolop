import { PrismaService } from '../prisma/prisma.service.js';

// 课程阈值从进入待派单的事件计算。重复扫描由收件人、版本和动作的联合唯一约束去重。
export async function scanOverdue(db:PrismaService, now=new Date()) {
  const cutoff=new Date(now.getTime()-30*60_000);
  return db.$executeRaw`
    INSERT INTO notices(ticket_no,version,recipient_id,action)
    SELECT t.ticket_no,t.version,u.id,'assignment_overdue'
    FROM tickets t JOIN ticket_events e ON t.id=e.ticket_id AND e.resulting_version=t.version
    JOIN users u ON u.department_id=t.department_id AND u.role='department_lead' AND u.registration_status='approved'
    WHERE t.status='pending_assignment' AND e.to_status='pending_assignment' AND e.created_at<=${cutoff}
    ON CONFLICT (ticket_no,version,recipient_id,action) DO NOTHING`;
}
