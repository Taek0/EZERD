-- 0018 had an earlier journal timestamp than 0017 and could be skipped on upgrades.
-- Keep published history intact; safely repair both skipped and already-applied databases.
ALTER TABLE "public"."user_workspaces" ADD COLUMN IF NOT EXISTS "sort_order" integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_workspaces'::regclass
      AND conname = 'user_workspaces_sort_order_nonnegative'
  ) THEN
    ALTER TABLE "public"."user_workspaces"
      ADD CONSTRAINT "user_workspaces_sort_order_nonnegative"
      CHECK ("sort_order" IS NULL OR "sort_order" >= 0);
  END IF;
END $$;
