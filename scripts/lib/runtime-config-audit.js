export const DEFAULT_PORT_OPERATION_API_URL = "http://apis.data.go.kr/1192000/VsslEtrynd5/Info5";

export const CONFIG_ENV_EXPECTATIONS = {
  required: [
    "PORT_OPERATION_SERVICE_KEY",
    "PORT_OPERATION_API_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY"
  ],
  acceptedFallbacks: {
    PORT_OPERATION_SERVICE_KEY: [
      "PORT_OPERATION_API_KEY",
      "DATA_GO_KR_API_KEY",
      "SERVICE_KEY",
      "SERVICEKEY",
      "YGPA_SERVICE_KEY"
    ],
    PORT_OPERATION_API_URL: [
      "default:PORT_OPERATION_API_URL=VsslEtrynd5/Info5"
    ]
  }
};

export function envPresent(name, env = process.env) {
  return Boolean(env?.[name] && String(env[name]).trim());
}

export function firstPresentEnv(names = [], env = process.env) {
  return names.find(name => envPresent(name, env)) || null;
}

export function portOperationServiceKeyPresent(env = process.env) {
  return Boolean(firstPresentEnv([
    "PORT_OPERATION_SERVICE_KEY",
    ...CONFIG_ENV_EXPECTATIONS.acceptedFallbacks.PORT_OPERATION_SERVICE_KEY
  ], env));
}

export function portOperationApiUrlInfo(env = process.env) {
  const canonicalPresent = envPresent("PORT_OPERATION_API_URL", env);
  return {
    canonical_present: canonicalPresent,
    effective_present: canonicalPresent || Boolean(DEFAULT_PORT_OPERATION_API_URL),
    default_used: !canonicalPresent && Boolean(DEFAULT_PORT_OPERATION_API_URL),
    source_name: canonicalPresent ? "PORT_OPERATION_API_URL" : "default_endpoint"
  };
}

export function missingRequiredEnvNames(env = process.env) {
  const missing = [];
  if (!portOperationServiceKeyPresent(env)) missing.push("PORT_OPERATION_SERVICE_KEY");
  if (!portOperationApiUrlInfo(env).effective_present) missing.push("PORT_OPERATION_API_URL");
  if (!envPresent("SUPABASE_URL", env)) missing.push("SUPABASE_URL");
  if (!envPresent("SUPABASE_SERVICE_ROLE_KEY", env)) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

export function buildRuntimeConfigAudit(env = process.env) {
  const serviceKeySource = firstPresentEnv([
    "PORT_OPERATION_SERVICE_KEY",
    ...CONFIG_ENV_EXPECTATIONS.acceptedFallbacks.PORT_OPERATION_SERVICE_KEY
  ], env);
  const apiUrl = portOperationApiUrlInfo(env);
  const fallbackPresence = Object.fromEntries(
    Object.entries(CONFIG_ENV_EXPECTATIONS.acceptedFallbacks).map(([key, aliases]) => [
      key,
      Object.fromEntries(
        aliases
          .filter(alias => !String(alias).startsWith("default:"))
          .map(alias => [alias, envPresent(alias, env)])
      )
    ])
  );
  return {
    generated_at: new Date().toISOString(),
    expected_env_names: CONFIG_ENV_EXPECTATIONS.required,
    accepted_fallback_env_names: CONFIG_ENV_EXPECTATIONS.acceptedFallbacks,
    canonical_env_present: {
      PORT_OPERATION_SERVICE_KEY: envPresent("PORT_OPERATION_SERVICE_KEY", env),
      PORT_OPERATION_API_URL: envPresent("PORT_OPERATION_API_URL", env),
      SUPABASE_URL: envPresent("SUPABASE_URL", env),
      SUPABASE_SERVICE_ROLE_KEY: envPresent("SUPABASE_SERVICE_ROLE_KEY", env)
    },
    fallback_env_present: fallbackPresence,
    effective_config_present: {
      PORT_OPERATION_SERVICE_KEY: Boolean(serviceKeySource),
      PORT_OPERATION_API_URL: apiUrl.effective_present,
      SUPABASE_URL: envPresent("SUPABASE_URL", env),
      SUPABASE_SERVICE_ROLE_KEY: envPresent("SUPABASE_SERVICE_ROLE_KEY", env)
    },
    effective_sources: {
      PORT_OPERATION_SERVICE_KEY: serviceKeySource || null,
      PORT_OPERATION_API_URL: apiUrl.source_name
    },
    port_operation_api_url_default_used: apiUrl.default_used,
    missing_required_env_names: missingRequiredEnvNames(env),
    runtime_flags: {
      VALIDATION_MODE: env.VALIDATION_MODE || null,
      UPDATE_MODE: env.UPDATE_MODE || null,
      CI: env.CI || null,
      GITHUB_ACTIONS: env.GITHUB_ACTIONS || null,
      GITHUB_RUN_ID: env.GITHUB_RUN_ID || null,
      GITHUB_WORKFLOW: env.GITHUB_WORKFLOW || null
    },
    is_github_actions: env.GITHUB_ACTIONS === "true" || Boolean(env.GITHUB_RUN_ID || env.GITHUB_WORKFLOW),
    is_local_build: !(env.GITHUB_ACTIONS === "true" || env.GITHUB_RUN_ID || env.GITHUB_WORKFLOW)
  };
}

export function buildRunOrigin({ runId = null, validationMode = null, servingMode = null, generatedBy = null } = {}, env = process.env) {
  const isGithubActions = env.GITHUB_ACTIONS === "true" || Boolean(env.GITHUB_RUN_ID || env.GITHUB_WORKFLOW);
  const supportedServingModes = new Set(["worker_supabase", "static_json", "local_diagnostics"]);
  const requestedServingMode = String(servingMode || env.SERVING_MODE || "").trim().toLowerCase();
  const normalizedServingMode = supportedServingModes.has(requestedServingMode)
    ? requestedServingMode
    : isGithubActions
      ? "static_json"
      : "local_diagnostics";
  return {
    generated_by: generatedBy || (isGithubActions ? "github_actions" : "local"),
    is_github_actions: isGithubActions,
    validation_mode: validationMode || env.VALIDATION_MODE || (env.CI === "true" ? "production" : "local"),
    serving_mode: normalizedServingMode,
    GITHUB_RUN_ID: env.GITHUB_RUN_ID || null,
    GITHUB_WORKFLOW: env.GITHUB_WORKFLOW || null,
    run_id: runId || null
  };
}

export function printRuntimeConfigAudit(audit = buildRuntimeConfigAudit()) {
  console.log("[CONFIG_AUDIT] PORT_OPERATION_SERVICE_KEY present:", audit.canonical_env_present.PORT_OPERATION_SERVICE_KEY);
  console.log("[CONFIG_AUDIT] PORT_OPERATION_API_URL present:", audit.canonical_env_present.PORT_OPERATION_API_URL);
  console.log("[CONFIG_AUDIT] SUPABASE_URL present:", audit.canonical_env_present.SUPABASE_URL);
  console.log("[CONFIG_AUDIT] SUPABASE_SERVICE_ROLE_KEY present:", audit.canonical_env_present.SUPABASE_SERVICE_ROLE_KEY);
  console.log("[CONFIG_AUDIT] VALIDATION_MODE:", audit.runtime_flags.VALIDATION_MODE);
  console.log("[CONFIG_AUDIT] UPDATE_MODE:", audit.runtime_flags.UPDATE_MODE);
  console.log("[CONFIG_AUDIT] CI:", audit.runtime_flags.CI);
  console.log("[CONFIG_AUDIT] GITHUB_ACTIONS:", audit.runtime_flags.GITHUB_ACTIONS);
  console.log("[CONFIG_AUDIT] GITHUB_RUN_ID:", audit.runtime_flags.GITHUB_RUN_ID);
  console.log("[CONFIG_AUDIT] GITHUB_WORKFLOW:", audit.runtime_flags.GITHUB_WORKFLOW);
  console.log("[CONFIG_AUDIT] expected_env_names:", audit.expected_env_names.join(","));
  console.log("[CONFIG_AUDIT] accepted_fallback_env_names:", JSON.stringify(audit.accepted_fallback_env_names));
  console.log("[CONFIG_AUDIT] fallback_env_present:", JSON.stringify(audit.fallback_env_present));
  console.log("[CONFIG_AUDIT] effective_config_present:", JSON.stringify(audit.effective_config_present));
  console.log("[CONFIG_AUDIT] effective_sources:", JSON.stringify(audit.effective_sources));
  console.log("[CONFIG_AUDIT] port_operation_api_url_default_used:", audit.port_operation_api_url_default_used);
  console.log("[CONFIG_AUDIT] missing_required_env_names:", audit.missing_required_env_names.join(",") || "none");
}
