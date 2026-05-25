export const config = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  dryRun: String(process.env.DRY_RUN || 'false').toLowerCase() === 'true',
  archiveToDrive: String(process.env.ARCHIVE_TO_DRIVE || 'false').toLowerCase() === 'true',
  driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
  serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ''
};

export function requireSupabaseUnlessDryRun() {
  if (!config.dryRun && (!config.supabaseUrl || !config.supabaseKey)) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them in GitHub Secrets or use DRY_RUN=true.');
  }
}
