-- EZERD postgresql / postgresql-18-v1; creates the entire physical design.

CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "public"."customers" (
  "customer_id" INTEGER NOT NULL
);
