-- Ensure contributions is in the Supabase realtime publication so
-- postgres_changes subscriptions on INSERTs fire (the graph panel listens for
-- them). Conditional because a dev database may have had it added by hand.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contributions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "contributions";
  END IF;
END $$;
