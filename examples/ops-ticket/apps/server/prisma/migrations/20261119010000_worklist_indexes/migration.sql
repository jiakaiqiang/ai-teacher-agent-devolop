CREATE INDEX tickets_company_time ON tickets(company_id,created_at DESC,id DESC);
CREATE INDEX tickets_department_status_time ON tickets(department_id,status,created_at DESC,id DESC);
