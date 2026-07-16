ALTER TABLE "messages" ADD COLUMN "reply_to_message_id" UUID;
ALTER TABLE "messages" ADD COLUMN "sequence" INTEGER;

WITH ranked_messages AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "conversation_id"
            ORDER BY "created_at" ASC, "id" ASC
        ) - 1 AS "sequence"
    FROM "messages"
)
UPDATE "messages"
SET "sequence" = ranked_messages."sequence"
FROM ranked_messages
WHERE "messages"."id" = ranked_messages."id";

ALTER TABLE "messages" ALTER COLUMN "sequence" SET NOT NULL;

CREATE UNIQUE INDEX "messages_reply_to_message_id_key" ON "messages"("reply_to_message_id");
CREATE UNIQUE INDEX "messages_conversation_id_sequence_key" ON "messages"("conversation_id", "sequence");

ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_fkey"
FOREIGN KEY ("reply_to_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
