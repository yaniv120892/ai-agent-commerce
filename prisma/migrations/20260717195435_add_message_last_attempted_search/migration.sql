-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "last_category_slug" TEXT,
ADD COLUMN     "last_search_terms" TEXT[] DEFAULT ARRAY[]::TEXT[];
