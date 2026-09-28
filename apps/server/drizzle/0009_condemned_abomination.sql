CREATE TABLE "project_personal_states" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"state" jsonb DEFAULT '{"views":[],"notes":[],"nodes":[],"viewports":[],"relations":[]}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_personal_states_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "project_personal_states" ADD CONSTRAINT "project_personal_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_personal_states" ADD CONSTRAINT "project_personal_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;