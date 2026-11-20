-- 先在纸上预测三个计数，再执行。开发库为 D02 固定样例。
SELECT c.name, count(DISTINCT t.id) AS company_visible, count(m.id) AS materials
FROM companies c
LEFT JOIN tickets t ON t.company_id = c.id
LEFT JOIN ticket_materials m ON m.ticket_id = t.id
GROUP BY c.name ORDER BY c.name;
SELECT d.name,count(t.id) AS department_visible,
       count(t.id) FILTER (WHERE t.status='pending_assignment') AS waiting_for_lead
FROM departments d LEFT JOIN tickets t ON t.department_id=d.id
GROUP BY d.name ORDER BY d.name;
