CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "document" jsonb DEFAULT '{"schemaVersion":1,"domains":[],"domainRelations":[],"notes":[],"layout":{"nodes":[],"viewports":[{"viewId":"overview","x":0,"y":0,"zoom":1}]}}'::jsonb NOT NULL;