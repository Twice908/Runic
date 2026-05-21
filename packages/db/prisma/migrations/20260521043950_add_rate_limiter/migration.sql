-- CreateTable
CREATE TABLE "RateLimitRule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pathPattern" TEXT NOT NULL,
    "limitKey" TEXT NOT NULL,
    "limitKeyHeader" TEXT,
    "limitCount" INTEGER NOT NULL,
    "windowSecs" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "limitKey" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitEvent_pkey" PRIMARY KEY ("id","timestamp")
);

-- CreateIndex
CREATE INDEX "RateLimitRule_projectId_enabled_idx" ON "RateLimitRule"("projectId", "enabled");

-- CreateIndex
CREATE INDEX "RateLimitEvent_projectId_timestamp_idx" ON "RateLimitEvent"("projectId", "timestamp");

-- CreateIndex
CREATE INDEX "RateLimitEvent_ruleId_timestamp_idx" ON "RateLimitEvent"("ruleId", "timestamp");

-- AddForeignKey
ALTER TABLE "RateLimitRule" ADD CONSTRAINT "RateLimitRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitEvent" ADD CONSTRAINT "RateLimitEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
