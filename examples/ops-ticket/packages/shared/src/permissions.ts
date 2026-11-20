export const grants = {
  reporter:['ticket:read','ticket:report','ticket:feedback'],
  customer_admin:['ticket:read','registration:approve'],
  department_lead:['ticket:read','ticket:assign','ticket:review','knowledge:approve'],
  operator:['ticket:read','ticket:handle'],
} as const;
export type Permission = typeof grants[keyof typeof grants][number];
