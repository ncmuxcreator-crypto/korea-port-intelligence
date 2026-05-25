import fs from "node:fs";
const tracked=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_ANON_KEY","MOF_AIS_DYNAMIC_API_URL","MOF_AIS_DYNAMIC_SERVICE_KEY","MOF_VTS_API_BASE","MOF_VTS_SERVICE_KEY","VESSEL_SPEC_SERVICE_KEY","PORT_OPERATION_SERVICE_KEY","PORT_FACILITY_SERVICE_KEY","PILOT_SOURCE_URLS","BERTH_SOURCE_URLS","ULSAN_API_KEY","YGPA_SERVICE_KEY","GDRIVE_SERVICE_ACCOUNT_JSON","GDRIVE_FOLDER_ID"];
const configured=tracked.filter(k=>Boolean(process.env[k]));
const report={version:"17.7.0",generatedAt:new Date().toISOString(),tracked:tracked.length,configured:configured.length,missing:tracked.filter(k=>!process.env[k]),realDataReady:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY),note:"Secret presence check only; no external API call."};
fs.mkdirSync("dashboard/api",{recursive:true});
fs.writeFileSync("dashboard/api/source-health-runtime.json",JSON.stringify(report,null,2));
console.log("Source health generated");
