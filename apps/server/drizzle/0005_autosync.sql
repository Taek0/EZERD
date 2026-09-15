ALTER TABLE "projects" ADD COLUMN "sync_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"base_sequence" integer NOT NULL,
	"baseline_issued_at" timestamp with time zone NOT NULL,
	"baseline_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"changes" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"deletion_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_operations_project_operation_unique" UNIQUE("project_id","operation_id"),
	CONSTRAINT "sync_operations_project_sequence_unique" UNIQUE("project_id","sequence")
);--> statement-breakpoint
CREATE TABLE "sync_field_versions" (
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"sequence" integer NOT NULL,
	"operation_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_field_versions_project_path_unique" UNIQUE("project_id","path")
);--> statement-breakpoint
CREATE TABLE "sync_client_baselines" (
	"baseline_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_successful_sync_at" timestamp with time zone NOT NULL,
	"last_sequence" integer NOT NULL,
	"document" jsonb NOT NULL,
	CONSTRAINT "sync_client_baselines_id_unique" UNIQUE("project_id","baseline_id")
);--> statement-breakpoint
CREATE TABLE "sync_tombstones" (
	"project_id" uuid NOT NULL,
	"object_id" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_tombstones_project_object_unique" UNIQUE("project_id","object_id")
);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "sync_field_versions" ADD CONSTRAINT "sync_field_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "sync_client_baselines" ADD CONSTRAINT "sync_client_baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "sync_client_baselines" ADD CONSTRAINT "sync_client_baselines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "sync_operations_project_created_idx" ON "sync_operations" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_client_baselines_identity_idx" ON "sync_client_baselines" ("project_id","client_id","user_id");--> statement-breakpoint
CREATE INDEX "sync_tombstones_expiry_idx" ON "sync_tombstones" ("expires_at");
