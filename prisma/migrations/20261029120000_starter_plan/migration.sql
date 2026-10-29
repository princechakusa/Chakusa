-- Starter: the $3 entry paid tier between the unpaid default (FREE) and PRO.
-- Additive only; existing rows keep their plan.
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'STARTER' BEFORE 'PRO';
