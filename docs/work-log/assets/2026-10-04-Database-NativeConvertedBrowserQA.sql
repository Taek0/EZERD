-- EZERD postgresql / postgresql-18-v1; creates the entire physical design.

CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "public"."legacy_items" (
  "signed_id" INTEGER NOT NULL
);
