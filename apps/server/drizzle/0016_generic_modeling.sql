ALTER TYPE "public"."project_database_kind" ADD VALUE 'generic';--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_database_profile_matches";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_database_profile_matches" CHECK ("projects"."database_profile_id" IS NULL OR
      ("projects"."database_kind" = 'postgresql' AND "projects"."database_profile_id" = 'postgresql-18-v1') OR
      ("projects"."database_kind" = 'mysql' AND "projects"."database_profile_id" = 'mysql-8.4-innodb-v1') OR
      ("projects"."database_kind" = 'sqlite' AND "projects"."database_profile_id" = 'sqlite-3.45-v1') OR
      ("projects"."database_kind"::text = 'generic' AND "projects"."database_profile_id" = 'generic-v1'));