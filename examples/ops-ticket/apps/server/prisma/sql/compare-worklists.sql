-- 在独立练习库运行。事务结束时撤销实验数据和实验索引。
BEGIN;
INSERT INTO tickets (id,ticket_no,title,description,company_id,category_id,department_id,reporter_id,status,created_at)
SELECT gen_random_uuid(), 'INDEX-LAB-' || n, '连接排查','测试日志', t.company_id,
 t.category_id,t.department_id,t.reporter_id,
 CASE WHEN n % 23 = 0 THEN 'pending_assignment' ELSE 'agent_processing' END,
 t.created_at + n * interval '1 second'
FROM generate_series(1,20000) AS series(n)
JOIN tickets t ON t.ticket_no = CASE WHEN n % 41 = 0 THEN 'T-002' ELSE 'T-001' END;
ANALYZE tickets;
EXPLAIN (ANALYZE, BUFFERS)
 SELECT ticket_no FROM tickets WHERE company_id=(SELECT id FROM companies WHERE name='乙公司')
 ORDER BY created_at DESC,id DESC LIMIT 20;
CREATE INDEX lab_company_time ON tickets(company_id,created_at DESC,id DESC);
CREATE INDEX lab_department_status_time ON tickets(department_id,status,created_at DESC,id DESC);
ANALYZE tickets;
EXPLAIN (ANALYZE, BUFFERS)
 SELECT ticket_no FROM tickets WHERE company_id=(SELECT id FROM companies WHERE name='乙公司')
 ORDER BY created_at DESC,id DESC LIMIT 20;
EXPLAIN (ANALYZE, BUFFERS)
 SELECT ticket_no FROM tickets WHERE department_id=(SELECT id FROM departments WHERE name='网络部')
 AND status='pending_assignment' ORDER BY created_at DESC,id DESC LIMIT 20;
ROLLBACK;
