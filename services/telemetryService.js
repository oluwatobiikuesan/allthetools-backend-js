const { createClient } = require("@supabase/supabase-js");
const config = require("../config/config");
const logger = require("../utils/logger");

const hasSupabaseCreds = Boolean(
  config.supabase?.url && config.supabase?.serviceKey
);

const supabaseClient = hasSupabaseCreds
  ? createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false, detectSessionInUrl: false },
    })
  : null;

function logDisabled(reason) {
  logger.debug(`[telemetry] skipped (${reason}); SUPABASE_URL or key missing`);
}

async function upsertJob(payload) {
  if (!supabaseClient) {
    logDisabled("job upsert");
    return;
  }

  const { error } = await supabaseClient
    .from(config.supabase.tables.jobs)
    .upsert(payload, { onConflict: "job_id" });

  if (error) {
    logger.warn("[telemetry] failed to upsert job", { error });
  }
}

async function insertCost(payload) {
  if (!supabaseClient) {
    logDisabled("cost ledger");
    return;
  }

  const { error } = await supabaseClient
    .from(config.supabase.tables.costLedger)
    .insert(payload);

  if (error) {
    logger.warn("[telemetry] failed to insert cost entry", { error });
  }
}

async function recordQueueSnapshot(payload) {
  if (!supabaseClient) {
    logDisabled("queue snapshot");
    return;
  }

  const { error } = await supabaseClient
    .from(config.supabase.tables.queueMetrics)
    .insert(payload);

  if (error) {
    logger.warn("[telemetry] failed to insert queue snapshot", { error });
  }
}

function calculateCosts({ filesizeBytes = 0, processingMs = 0, retentionHours }) {
  const bytesPerGb = 1024 ** 3;
  const egressGb = filesizeBytes / bytesPerGb;
  const computeMinutes = processingMs / 1000 / 60;
  const storageGbHours = egressGb * (retentionHours || 24);

  const egressCost = egressGb * config.costs.egressPerGb;
  const computeCost = computeMinutes * config.costs.computePerMinute;
  const storageCost = storageGbHours * config.costs.storagePerGbHour;

  const estimated = Number(
    (egressCost + computeCost + storageCost).toFixed(4)
  );

  return {
    egressGb,
    computeMinutes,
    storageGbHours,
    estimatedCost: estimated,
  };
}

module.exports = {
  upsertJob,
  insertCost,
  recordQueueSnapshot,
  calculateCosts,
};
