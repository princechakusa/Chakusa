-- #18 Omnichannel: server-side unread state for the unified business inbox.
-- Additive only. Existing conversations get NULL (treated as unread if they
-- have an inbound message).
ALTER TABLE "conversations" ADD COLUMN "last_read_at" TIMESTAMP(3);
