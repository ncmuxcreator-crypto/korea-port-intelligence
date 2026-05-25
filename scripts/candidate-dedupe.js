import fs from "node:fs";
const path="dashboard/api/vessels.json";
const data=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,"utf8")):[];
const vessels=Array.isArray(data)?data:(data.vessels||data.items||data.data||[]);
const seen=new Set(),duplicates=[];
for(const v of vessels){const key=String(v.imo||v.mmsi||v.vessel_name||v.name||"").toUpperCase(); if(!key) continue; if(seen.has(key)) duplicates.push(key); seen.add(key);}
const report={version:"17.7.0",generatedAt:new Date().toISOString(),total:vessels.length,duplicates,ok:duplicates.length===0};
fs.mkdirSync("dashboard/api",{recursive:true}); fs.writeFileSync("dashboard/api/candidate-dedupe.json",JSON.stringify(report,null,2));
if(!report.ok){console.error("Duplicate candidates detected",duplicates); process.exit(1);}
console.log("Candidate dedupe passed");
