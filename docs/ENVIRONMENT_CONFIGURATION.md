# Environment configuration

Chakusa does not store `.env` files or environment templates in Git. Configuration must be injected into the process by the deployment platform, CI system, EAS, Cloudflare, or an approved local secret manager.

The tracked `.gitignore` blocks `.env` files and common private-key formats. CI runs `npm run security:repository` and rejects a change if one of those files is tracked.

## Local test API

Supply `DATABASE_URL` and optionally `DIRECT_URL` in the current shell, pointing to a local PostgreSQL database named exactly `chakusa_test`, then run `npm run dev:test`. The safety guard rejects remote hosts, other database names, and non-test environments. The script generates an ephemeral JWT secret and explicitly disables remote integrations.

For Prisma maintenance, supply the same URL under `CHAKUSA_LOCAL_TEST_DATABASE_URL` and run `node scripts/prisma-local.mjs <command>`. The wrapper passes credentials directly to the child process and never reads or writes a configuration file.

## Deployment

Configure required values in the hosting platform's encrypted environment or secret store. Relevant groups include database connectivity, authentication secrets, provider credentials, billing verification, monitoring, messaging, email, and the exact administration-console origin.

Public mobile and admin build variables must be configured in EAS, CI, or Cloudflare build settings. Backend secrets must never use public-variable prefixes or be embedded in a client build.

Do not commit configuration exports, copied dashboards, command transcripts containing credentials, or `.env*` files under any name.
