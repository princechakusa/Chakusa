ALTER TABLE "automation_runs" ADD COLUMN "review_request_id" TEXT;

CREATE INDEX "automation_runs_review_request_id_idx" ON "automation_runs"("review_request_id");

ALTER TABLE "automation_runs"
ADD CONSTRAINT "automation_runs_review_request_id_fkey"
FOREIGN KEY ("review_request_id") REFERENCES "review_requests"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
