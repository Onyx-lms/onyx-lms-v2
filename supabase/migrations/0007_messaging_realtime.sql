-- 0007_messaging_realtime.sql
--
-- M-02: Supabase Realtime delivery for direct messages.
--
-- No new tables and no column changes -- this only grants the reads that
-- Realtime needs and adds `messages` to the publication it listens on.
--
-- Both tables keep the deny-all baseline for everything else: writes still go
-- exclusively through the API on the service-role key. What changes is that a
-- participant may SELECT their own conversation, which is the condition
-- Realtime evaluates before it forwards a row to a subscribed client.
--
-- onyx.current_user_id() reads the bigint user_id claim. auth.uid() would cast
-- `sub` to uuid and throw -- see ADR-001.

CREATE POLICY "messages_participant_read" ON public."messages"
  FOR SELECT TO authenticated
  USING (
    "sender_id" = onyx.current_user_id()
    OR "receiver_id" = onyx.current_user_id()
  );

CREATE POLICY "message_threads_participant_read" ON public."message_threads"
  FOR SELECT TO authenticated
  USING (
    "contact_one" = onyx.current_user_id()
    OR "contact_two" = onyx.current_user_id()
  );

-- Realtime only forwards changes for tables in this publication. Adding a table
-- twice is an error, so this is guarded.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."messages";
  END IF;
END
$$;

-- DELETE events carry only the primary key unless the replica identity is
-- widened. The client needs thread_id to know which conversation lost a
-- message, so send the whole old row.
ALTER TABLE public."messages" REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
