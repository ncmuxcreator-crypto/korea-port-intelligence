import fs from "node:fs";
const path="dashboard/api/vessels.json";
const data=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,"utf8")):[];
const vessels=Array.isArray(data)?data:(data.vessels||data.items||data.data||[]);
const windows={"0-24h":[],"24-72h":[],"Next snapshot":[],"Archive":[]};
for(const v of vessels){const w=v.contact_window||"Archive"; if(!windows[w]) windows[w]=[]; windows[w].push({rank:v.rank,vessel_name:v.vessel_name||v.name,imo:v.imo||null,port:v.port||v.current_port||null,score:v.candidate_score||0,tier:v.candidate_tier||"Low"});}
fs.mkdirSync("dashboard/api",{recursive:true}); fs.writeFileSync("dashboard/api/contact-windows.json",JSON.stringify({version:"17.7.0",generatedAt:new Date().toISOString(),windows},null,2));
console.log("Contact windows generated");
