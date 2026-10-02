CREATE TABLE "project_database_operations" (
	"project_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_database_operations_project_id_operation_id_pk" PRIMARY KEY("project_id","operation_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "database_profile_id" varchar(80);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "database_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_client_baselines" ADD COLUMN "database_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_database_operations" ADD CONSTRAINT "project_database_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_database_operations" ADD CONSTRAINT "project_database_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_database_revision_nonnegative" CHECK ("projects"."database_revision" >= 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_database_profile_matches" CHECK ("projects"."database_profile_id" IS NULL OR
      ("projects"."database_kind" = 'postgresql' AND "projects"."database_profile_id" = 'postgresql-18-v1') OR
      ("projects"."database_kind" = 'mysql' AND "projects"."database_profile_id" = 'mysql-8.4-innodb-v1') OR
      ("projects"."database_kind" = 'sqlite' AND "projects"."database_profile_id" = 'sqlite-3.45-v1'));
--> statement-breakpoint
UPDATE "projects" SET "database_profile_id" = CASE "database_kind"
  WHEN 'postgresql' THEN 'postgresql-18-v1'
  WHEN 'mysql' THEN 'mysql-8.4-innodb-v1'
  WHEN 'sqlite' THEN 'sqlite-3.45-v1'
END WHERE "database_profile_id" IS NULL;
