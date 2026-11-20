-- 在 D02 的两行种子上比较两种分页。同一事务结束时撤销插入。
BEGIN;
CREATE TEMP TABLE first_page ON COMMIT DROP AS
SELECT id,created_at,ticket_no FROM tickets ORDER BY created_at DESC,id DESC LIMIT 1;
INSERT INTO tickets (id,ticket_no,title,description,company_id,category_id,department_id,reporter_id,created_at)
SELECT gen_random_uuid(),'PAGE-NEW',title,description,company_id,category_id,department_id,reporter_id,
created_at+interval '1 minute' FROM tickets WHERE ticket_no='T-001';
SELECT 'offset',ticket_no FROM tickets ORDER BY created_at DESC,id DESC LIMIT 1 OFFSET 1;
SELECT 'cursor',t.ticket_no FROM tickets t,first_page f
WHERE (t.created_at,t.id)<(f.created_at,f.id) ORDER BY t.created_at DESC,t.id DESC LIMIT 1;
SELECT 'first',ticket_no FROM first_page;
ROLLBACK;
