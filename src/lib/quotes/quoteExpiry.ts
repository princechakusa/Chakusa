import { prisma } from "../prisma.js";

// PROGRAM 3 LOOP 3F.2: server-side expiration of SENT quotes whose
// commercial expiry (QuoteDocument.expiresAt) has passed.
//
// Runs from the shared worker (automationWorker.ts) and the external
// scheduled-work cycle (scheduledWorkTrigger.ts) - the same pattern as
// expireAttachments / sendDueAppointmentReminders. It is:
//   - idempotent: each document is transitioned by a conditional
//     updateMany(where status='SENT' AND expiresAt<=now); a row already
//     moved on (accepted / declined / canceled / expired by a prior
//     sweep or a concurrent request) matches zero rows and is skipped;
//   - per-document atomic: the status flip, the token revocation and the
//     EXPIRED event happen in one transaction, so there is never an
//     EXPIRED document without its event or with a still-live token;
//   - bounded: at most `batchSize` documents per call.
//
// Customer-side expiry is ALREADY enforced independently of this sweep:
// the acceptance token's own expiresAt is min(sendTime + TTL,
// document.expiresAt), so an over-deadline quote's token is already
// expired and publicQuotes rejects action on it. This sweep makes the
// business-visible status and the event ledger catch up.

export async function sweepExpiredQuotes(now: Date = new Date(), batchSize = 100): Promise<{ expired: number }> {
  const due = await prisma.quoteDocument.findMany({
    where: { status: "SENT", expiresAt: { not: null, lte: now } },
    select: { id: true, currentRevisionId: true },
    orderBy: { expiresAt: "asc" },
    take: batchSize,
  });

  let expired = 0;
  for (const document of due) {
    const applied = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.quoteDocument.updateMany({
        where: { id: document.id, status: "SENT", expiresAt: { not: null, lte: now } },
        data: { status: "EXPIRED" },
      });
      if (transitioned.count !== 1) return false;

      await tx.quoteAcceptanceToken.updateMany({
        where: { quoteRevision: { quoteDocumentId: document.id }, revokedAt: null },
        data: { revokedAt: now },
      });

      await tx.quoteEvent.create({
        data: {
          quoteDocumentId: document.id,
          quoteRevisionId: document.currentRevisionId,
          eventType: "EXPIRED",
          actorType: "SYSTEM",
          actorId: null,
        },
      });
      return true;
    });
    if (applied) expired += 1;
  }

  return { expired };
}
