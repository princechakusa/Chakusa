import { Prisma } from "@prisma/client";

// Every application DateTime column is `timestamp(3)` without a time zone,
// holding UTC. A JS Date in raw SQL is sent as `timestamptz`, and comparing
// or assigning the two converts through the database session's TimeZone, so
// raw queries were only correct on a UTC session (a non-UTC database silently
// skipped due reminders and mis-wrote leases). Wrap every Date passed to raw
// SQL in utc(), and use UTC_NOW instead of NOW().
export const utc = (date: Date) => Prisma.sql`(${date}::timestamptz AT TIME ZONE 'UTC')`;
export const UTC_NOW = Prisma.sql`(NOW() AT TIME ZONE 'UTC')`;
