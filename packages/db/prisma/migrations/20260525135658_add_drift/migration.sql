-- CreateEnum
CREATE TYPE "DriftEventType" AS ENUM ('MISSING_KEY', 'EXTRA_KEY', 'STALE_ROTATION', 'KEY_RESTORED');

-- CreateTable
CREATE TABLE "DriftEnvironment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "driftScore" INTEGER NOT NULL DEFAULT 100,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriftEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriftManifest" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "keys" TEXT[],
    "agentVersion" TEXT,
    "agentId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriftManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriftEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "keyName" TEXT NOT NULL,
    "driftType" "DriftEventType" NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DriftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriftKeyMeta" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT,
    "keyName" TEXT NOT NULL,
    "description" TEXT,
    "owner" TEXT,
    "rotationDays" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChangedAt" TIMESTAMP(3),
    "isIgnored" BOOLEAN NOT NULL DEFAULT false,
    "ignoreReason" TEXT,

    CONSTRAINT "DriftKeyMeta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriftEnvironment_projectId_name_key" ON "DriftEnvironment"("projectId", "name");

-- CreateIndex
CREATE INDEX "DriftManifest_environmentId_capturedAt_idx" ON "DriftManifest"("environmentId", "capturedAt");

-- CreateIndex
CREATE INDEX "DriftEvent_projectId_detectedAt_idx" ON "DriftEvent"("projectId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriftKeyMeta_projectId_keyName_environmentId_key" ON "DriftKeyMeta"("projectId", "keyName", "environmentId");

-- AddForeignKey
ALTER TABLE "DriftEnvironment" ADD CONSTRAINT "DriftEnvironment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriftManifest" ADD CONSTRAINT "DriftManifest_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "DriftEnvironment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriftManifest" ADD CONSTRAINT "DriftManifest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriftEvent" ADD CONSTRAINT "DriftEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriftEvent" ADD CONSTRAINT "DriftEvent_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "DriftEnvironment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriftKeyMeta" ADD CONSTRAINT "DriftKeyMeta_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriftKeyMeta" ADD CONSTRAINT "DriftKeyMeta_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "DriftEnvironment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
