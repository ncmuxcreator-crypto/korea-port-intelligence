import crypto from "crypto";

function serviceAccountJson() {
  const raw = process.env.GDRIVE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const value = String(raw).trim();
  const candidates = [
    value,
    value.replace(/^['"]|['"]$/g, ""),
    value.replace(/\\n/g, "\n")
  ];
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim();
    if (decoded.startsWith("{")) candidates.push(decoded, decoded.replace(/\\n/g, "\n"));
  } catch {
    // Not base64; fall through to normal JSON parsing.
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed?.client_email && parsed?.private_key) return parsed;
    } catch {
      // Try the next common secret format.
    }
  }
  return null;
}

function normalizeFolderId(value) {
  if (!value) return "";
  const text = String(value).trim();
  const foldersMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (foldersMatch) return foldersMatch[1];
  const idMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return text;
}

function accountHint(account) {
  if (!account?.client_email) return null;
  try {
    const [name, domain] = String(account.client_email).split("@");
    return `${name?.slice(0, 4) || "svc"}***@${domain || "serviceaccount"}`;
  } catch {
    return null;
  }
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(account.private_key, "base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const assertion = `${unsigned}.${signature}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Google token HTTP ${res.status}`);
  }
  return json.access_token;
}

export async function archiveRawToGDrive(payload, { namePrefix = "korea-port-intelligence-raw" } = {}) {
  const account = serviceAccountJson();
  const folderId = normalizeFolderId(process.env.GDRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID);
  const archiveEnabled = String(process.env.ARCHIVE_TO_DRIVE || "true").toLowerCase() !== "false";

  if (!archiveEnabled) return { status: "disabled" };
  if (!account) return { status: "not_configured", reason: "missing_or_invalid_service_account_json" };
  if (!folderId) return { status: "not_configured", reason: "missing_folder_id" };

  const token = await getAccessToken(account);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const metadata = {
    name: `${namePrefix}-${timestamp}.json`,
    mimeType: "application/json",
    parents: [folderId]
  };
  const boundary = `korea_port_intelligence_${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(payload, null, 2),
    `--${boundary}--`,
    ""
  ].join("\r\n");

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  const json = await res.json();
  if (!res.ok) {
    const message = json.error?.message || `Google Drive upload HTTP ${res.status}`;
    if (res.status === 403 || res.status === 404) {
      throw new Error(`${message}. Check that the Drive folder is shared with service account ${accountHint(account) || "client_email"} and that Google Drive API is enabled.`);
    }
    throw new Error(message);
  }
  return { status: "uploaded", file_id: json.id, name: json.name, webViewLink: json.webViewLink };
}

export function buildRawArchivePayload({
  runId,
  generatedAt,
  rawRecords = [],
  normalizedRecords = [],
  targetRecords = [],
  report = {},
  collectorDiagnostics = {},
  supabaseWrite = {}
} = {}) {
  return {
    archive_version: "raw-archive-v1",
    run_id: runId || report.run_id || null,
    generated_at: generatedAt || new Date().toISOString(),
    storage_role: "external_raw_archive",
    retention_note: "Supabase stores compact operational rows; this archive keeps heavier collector and normalized payloads outside the database.",
    counts: {
      raw_records: rawRecords.length,
      normalized_records: normalizedRecords.length,
      target_records: targetRecords.length
    },
    collector_diagnostics: collectorDiagnostics,
    supabase_write: {
      status: supabaseWrite.status || null,
      runId: supabaseWrite.runId || null,
      promoted: supabaseWrite.promoted ?? null,
      recordsSaved: supabaseWrite.recordsSaved ?? null,
      mode: supabaseWrite.mode || null,
      retentionCleanup: supabaseWrite.retentionCleanup || null
    },
    report_summary: {
      status: report.status || null,
      data_mode: report.data_mode || null,
      all_collected_vessel_count: report.all_collected_vessel_count || 0,
      raw_collected_vessel_count: report.raw_collected_vessel_count || 0,
      target_vessel_count: report.target_vessel_count || 0,
      sales_candidate_count: report.sales_candidate_count || 0,
      immediate_target_count: report.immediate_target_count || 0,
      completed_at: report.completed_at || null
    },
    raw_records: rawRecords,
    normalized_records: normalizedRecords,
    target_records: targetRecords
  };
}
