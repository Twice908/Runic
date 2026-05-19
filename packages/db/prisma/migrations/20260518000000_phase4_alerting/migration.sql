-- AlterTable: add url and route fields to Alert
ALTER TABLE "Alert" ADD COLUMN "url" TEXT,
                    ADD COLUMN "route" TEXT;

-- CreateTable: AlertEvent
CREATE TABLE "AlertEvent" (
    "id"             TEXT NOT NULL,
    "alertId"        TEXT NOT NULL,
    "projectId"      TEXT NOT NULL,
    "type"           TEXT NOT NULL,
    "triggeredValue" DOUBLE PRECISION NOT NULL,
    "threshold"      DOUBLE PRECISION NOT NULL,
    "message"        TEXT NOT NULL,
    "channel"        TEXT NOT NULL,
    "destination"    TEXT NOT NULL,
    "sentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
