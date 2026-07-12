-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "pendingDesktopNotify" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingSound" BOOLEAN NOT NULL DEFAULT false;
