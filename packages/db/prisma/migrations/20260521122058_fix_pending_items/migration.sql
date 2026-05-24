-- DropForeignKey
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ErrorEvent" DROP CONSTRAINT "ErrorEvent_projectId_fkey";

-- DropForeignKey
ALTER TABLE "RateLimitEvent" DROP CONSTRAINT "RateLimitEvent_projectId_fkey";

-- DropForeignKey
ALTER TABLE "RateLimitRule" DROP CONSTRAINT "RateLimitRule_projectId_fkey";

-- DropForeignKey
ALTER TABLE "RequestLog" DROP CONSTRAINT "RequestLog_projectId_fkey";

-- DropForeignKey
ALTER TABLE "UptimeCheck" DROP CONSTRAINT "UptimeCheck_projectId_fkey";

-- AlterTable
ALTER TABLE "ErrorEvent" ADD COLUMN     "resolved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "RequestLog" ADD CONSTRAINT "RequestLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UptimeCheck" ADD CONSTRAINT "UptimeCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitRule" ADD CONSTRAINT "RateLimitRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitEvent" ADD CONSTRAINT "RateLimitEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
