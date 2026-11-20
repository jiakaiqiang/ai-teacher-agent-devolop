-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "description" VARCHAR(200) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 主业务角色同步到关联表。新注册账号和已有种子使用同一份授权映射。
INSERT INTO roles(id,code,name) SELECT gen_random_uuid(), code, code FROM
  (VALUES ('reporter'),('customer_admin'),('department_lead'),('operator')) AS r(code);
INSERT INTO permissions(id,code,description) SELECT gen_random_uuid(),code,code FROM
 (VALUES ('ticket:read'),('ticket:report'),('ticket:feedback'),('registration:approve'),
 ('ticket:assign'),('ticket:review'),('knowledge:approve'),('ticket:handle')) AS p(code);
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE p.code='ticket:read'
 OR (r.code='reporter' AND p.code IN ('ticket:report','ticket:feedback'))
 OR (r.code='customer_admin' AND p.code='registration:approve')
 OR (r.code='department_lead' AND p.code IN ('ticket:assign','ticket:review','knowledge:approve'))
 OR (r.code='operator' AND p.code='ticket:handle');
CREATE FUNCTION sync_primary_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    DELETE FROM user_roles WHERE user_id=NEW.id AND role_id=(SELECT id FROM roles WHERE code=OLD.role);
  END IF;
  INSERT INTO user_roles(user_id,role_id) SELECT NEW.id,id FROM roles WHERE code=NEW.role
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_role AFTER INSERT OR UPDATE OF role ON users FOR EACH ROW EXECUTE FUNCTION sync_primary_role();
INSERT INTO user_roles(user_id,role_id) SELECT u.id,r.id FROM users u JOIN roles r ON r.code=u.role;
