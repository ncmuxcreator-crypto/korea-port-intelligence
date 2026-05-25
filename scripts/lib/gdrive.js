import crypto from "crypto";

function serviceAccountJson() {
  const raw = process.env.GDRIVE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
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

export async function archiveRawToGDrive(payload, { namePrefix = "hwk-raw" } = {}) {
  const account = serviceAccountJson();
  const folderId = process.env.GDRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID;
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
  const boundary = `hwk_${crypto.randomUUID()}`;
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

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || `Google Drive upload HTTP ${res.status}`);
  }
  return { status: "uploaded", file_id: json.id, name: json.name, webViewLink: json.webViewLink };
}
