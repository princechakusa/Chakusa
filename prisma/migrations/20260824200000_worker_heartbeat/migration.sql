CREATE TABLE "worker_heartbeats" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_success_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);
