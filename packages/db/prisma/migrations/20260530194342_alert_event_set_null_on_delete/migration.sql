-- DropForeignKey
ALTER TABLE "AlertEvent" DROP CONSTRAINT "AlertEvent_alertId_fkey";

-- AlterTable
ALTER TABLE "AlertEvent" ALTER COLUMN "alertId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
