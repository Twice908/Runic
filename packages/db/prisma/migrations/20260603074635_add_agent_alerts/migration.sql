-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "agentMetrics" JSONB;

-- AlterTable
ALTER TABLE "AlertEvent" ADD COLUMN     "agentRunId" TEXT;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
