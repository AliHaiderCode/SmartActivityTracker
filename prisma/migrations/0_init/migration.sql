-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceId" TEXT,
    "title" TEXT,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "actorId" TEXT,
    "summary" TEXT,
    "payload" JSONB NOT NULL,
    "webhookId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLog_webhookId_key" ON "ActivityLog"("webhookId");

-- CreateIndex
CREATE INDEX "ActivityLog_shop_createdAt_idx" ON "ActivityLog"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_shop_resource_idx" ON "ActivityLog"("shop", "resource");

-- CreateIndex
CREATE INDEX "ActivityLog_shop_topic_idx" ON "ActivityLog"("shop", "topic");

-- CreateIndex
CREATE INDEX "ActivityLog_shop_actorEmail_idx" ON "ActivityLog"("shop", "actorEmail");

-- CreateIndex
CREATE INDEX "ActivityLog_shop_resourceId_idx" ON "ActivityLog"("shop", "resourceId");

