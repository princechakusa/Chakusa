# Chakusa backup & recovery procedures

Chakusa's state of record is a single PostgreSQL database. There is no other
durable store (no object storage, no external queue — the outbox, dispatch
queue, workflow executions and AI ledgers are all tables). Protecting the
database protects everything.

## Backup strategy

| Layer | What | Cadence | Retention |
|---|---|---|---|
| Provider automated backups | Full snapshot | Daily (provider default) | ≥ 30 days |
| Point-in-time recovery (PITR) | WAL archiving | Continuous | ≥ 7 days (target 14) |
| Pre-deploy logical dump | `pg_dump -Fc` of the whole DB | Before every migration deploy | ≥ 14 days, off-provider |
| Monthly restore drill | Restore the latest dump into a scratch DB and run `npx prisma migrate status` + a smoke query | Monthly | drill log only |

Enable **both** provider snapshots and PITR. Snapshots bound restore effort; PITR bounds data loss (RPO).

### Targets

- **RPO** (max data loss): ≤ 5 minutes (PITR).
- **RTO** (max downtime): ≤ 60 minutes for a full restore.

## Taking a manual backup (before a migration)

```
pg_dump -Fc "$DIRECT_URL" > chakusa-$(date +%Y%m%d-%H%M%S).dump
```

Store it off the database provider (a separate bucket / encrypted archive).
Record the current migration name: `npx prisma migrate status`.

## Restore procedures

### A. Roll back a bad migration (data still good)

There are **no `down` migrations** by design. If the new schema is wrong but
data is intact and the new code is not yet serving traffic:

1. Redeploy the previous code build (it ignores the new columns/tables).
2. Leave the additive schema in place, or restore from the pre-deploy dump into a fresh DB and cut over.

### B. Data corruption / accidental mass delete

1. Stop the API and worker (or set `maintenance_mode`).
2. PITR-restore to a timestamp just before the incident, **or** restore the latest `pg_dump` and accept loss back to that dump.
3. Point `DATABASE_URL`/`DIRECT_URL` at the restored instance.
4. `npx prisma migrate status` must report "up to date". If the restored point predates a migration, run `npx prisma migrate deploy`.
5. Start the worker first (it recovers expired outbox claims and deliveries), then the API.
6. Smoke test per `DEPLOYMENT_GUIDE.md` §7.

### C. Full region loss

Restore the latest cross-region snapshot in the standby region, apply PITR to
the last archived WAL, then follow B §3–6.

## What self-heals after a restore

- **Messaging**: PENDING/RETRY dispatches drain via the worker with back-off; DEAD ones need `retryDispatch`.
- **Automation/workflows**: expired leases are reclaimed; PENDING work re-runs; schedules re-initialize on worker boot.
- **Outbox**: unpublished events are re-published by `outboxPublisher`.
- **AI**: `AIConversationRun`s left mid-flight are not auto-resumed — they are terminal states or safe to leave; the customer's next message opens a new run. Circuit breakers reset. `pruneExpiredMemory` cleans stale sessions on its next pass.

## What does NOT self-heal

- In-flight HTTP requests at the moment of failure (client retries).
- A provider webhook that arrived during downtime and was not 200'd — the provider (Twilio/Stripe/Apple/Google) retries on its own schedule; confirm redelivery.
- External side effects already committed at the provider (a sent SMS, a captured payment) — reconcile against the provider, not the backup.
