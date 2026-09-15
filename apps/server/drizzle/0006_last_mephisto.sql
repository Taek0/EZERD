ALTER TABLE "users" DROP CONSTRAINT "users_username_pin_unique";--> statement-breakpoint
UPDATE "users" SET "username" = lower(btrim("username"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");
