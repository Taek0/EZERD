-- EZERD PostgreSQL creation DDL

CREATE TABLE "public"."parent" (
  "id" integer NOT NULL,
  CONSTRAINT "parent_pk" PRIMARY KEY ("id")
);

CREATE TABLE "public"."child" (
  "parent_id" integer
);

ALTER TABLE "public"."child" ADD CONSTRAINT "child_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parent" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

COMMENT ON TABLE "public"."parent" IS E'한글 설명';

COMMENT ON TABLE "public"."child" IS E'한글 설명';

