-- CreateTable
CREATE TABLE "DirectMessagePreview" (
    "id" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "previewText" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectMessagePreview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DirectMessagePreview_senderName_key" ON "DirectMessagePreview"("senderName");
