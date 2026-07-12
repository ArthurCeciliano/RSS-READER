-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('rss', 'atom', 'json_feed', 'youtube', 'instagram', 'tiktok', 'reddit', 'twitter');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('ok', 'degraded', 'failing');

-- CreateEnum
CREATE TYPE "RuleAction" AS ENUM ('mark_read', 'star', 'apply_tag', 'notify_desktop', 'play_sound');

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "folderId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "identityUrl" TEXT NOT NULL,
    "feedUrl" TEXT,
    "siteUrl" TEXT,
    "faviconUrl" TEXT,
    "type" "SourceType" NOT NULL,
    "scanIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "maxEntries" INTEGER NOT NULL DEFAULT 20,
    "inactiveLimitDays" INTEGER NOT NULL DEFAULT 180,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "nextFetchAt" TIMESTAMP(3),
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
    "status" "SourceStatus" NOT NULL DEFAULT 'ok',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "guid" TEXT,
    "link" TEXT,
    "dedupeHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "contentHtml" TEXT,
    "imageUrl" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagsOnItems" (
    "itemId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "TagsOnItems_pkey" PRIMARY KEY ("itemId","tagId")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Source_identityUrl_key" ON "Source"("identityUrl");

-- CreateIndex
CREATE INDEX "Source_folderId_idx" ON "Source"("folderId");

-- CreateIndex
CREATE INDEX "Source_nextFetchAt_idx" ON "Source"("nextFetchAt");

-- CreateIndex
CREATE INDEX "Item_sourceId_publishedAt_idx" ON "Item"("sourceId", "publishedAt");

-- CreateIndex
CREATE INDEX "Item_isRead_idx" ON "Item"("isRead");

-- CreateIndex
CREATE INDEX "Item_isStarred_idx" ON "Item"("isStarred");

-- CreateIndex
CREATE UNIQUE INDEX "Item_sourceId_dedupeHash_key" ON "Item"("sourceId", "dedupeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagsOnItems" ADD CONSTRAINT "TagsOnItems_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagsOnItems" ADD CONSTRAINT "TagsOnItems_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

