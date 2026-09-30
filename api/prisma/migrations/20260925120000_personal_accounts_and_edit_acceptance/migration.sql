-- Personal accounts: company ID of the person, accountability acknowledgment
ALTER TABLE "users" ADD COLUMN "id_number" TEXT;
ALTER TABLE "users" ADD COLUMN "accountability_accepted_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "accountability_ip" TEXT;
CREATE UNIQUE INDEX "users_id_number_key" ON "users"("id_number");

-- Person-targeted approvals (WAREHOUSE_EDIT acceptance by the document's creator)
ALTER TABLE "approval_requests" ADD COLUMN "required_approver_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
