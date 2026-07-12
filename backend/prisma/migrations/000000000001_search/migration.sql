-- Full-text search (module 3): a generated tsvector column over title+summary,
-- with a GIN index. Modeled in schema.prisma as Unsupported("tsvector") since
-- Prisma can't manage generated columns -- queried via $queryRaw in the search
-- route, never through the normal Client query API.
ALTER TABLE "Item" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("summary", ''))
  ) STORED;

CREATE INDEX "Item_searchVector_idx" ON "Item" USING GIN ("searchVector");
