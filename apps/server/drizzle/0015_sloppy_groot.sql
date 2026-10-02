CREATE TABLE "native_request_cancellations" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"client_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"source_operation_id" uuid,
	"result" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "native_request_cancellations" ADD CONSTRAINT "native_request_cancellations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_request_cancellations" ADD CONSTRAINT "native_request_cancellations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "native_request_cancellations_project_idx" ON "native_request_cancellations" USING btree ("project_id");