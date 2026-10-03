-- EZERD postgresql / postgresql-18-v1; creates the entire physical design.

CREATE SCHEMA IF NOT EXISTS "public";

CREATE SCHEMA IF NOT EXISTS "qa_labels";

CREATE TYPE "qa_labels"."label_state" AS ENUM (E'', E'line
break', E'한글😀');

CREATE TABLE "public"."pg_records" (
  "record_id" INTEGER NOT NULL,
  CONSTRAINT "pk_pg_records" PRIMARY KEY ("record_id")
);
