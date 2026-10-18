import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: [{ emit: "event", level: "error" }, { emit: "event", level: "warn" }],
});

// Prisma's default stderr messages can include query arguments. Keep database
// failure signals without copying raw messages into retained application logs.
prisma.$on("error", event => console.error("[database] operation failed", { target: event.target, code: event.message.match(/\bP\d{4}\b/)?.[0] }));
prisma.$on("warn", event => console.warn("[database] warning", { target: event.target }));
