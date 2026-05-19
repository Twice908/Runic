/*
  Warnings:

  - The primary key for the `RequestLog` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "RequestLog" DROP CONSTRAINT "RequestLog_pkey",
ADD CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id", "timestamp");
