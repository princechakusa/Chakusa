import { claimWorkflowExecutions, executeClaimedWorkflow, recoverExpiredWorkflowLeases } from "../lib/automation/workflowRuntime.js";
export async function processWorkflowExecutions(batchSize = 25) { await recoverExpiredWorkflowLeases(); const claim = await claimWorkflowExecutions(batchSize); for (const id of claim.ids) await executeClaimedWorkflow(id, claim.owner); return claim.ids.length; }
