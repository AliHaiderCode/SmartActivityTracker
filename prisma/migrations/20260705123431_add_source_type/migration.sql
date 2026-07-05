-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'system';

-- CreateIndex
CREATE INDEX "ActivityLog_shop_sourceType_idx" ON "ActivityLog"("shop", "sourceType");
