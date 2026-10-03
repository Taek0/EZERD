-- EZERD sqlite / sqlite-3.45-v1; creates the entire physical design.

PRAGMA foreign_keys = ON;

CREATE TABLE "strict_items" (
  "id" INTEGER NOT NULL,
  CONSTRAINT "strict_items_pk" PRIMARY KEY ("id")
) STRICT, WITHOUT ROWID;
