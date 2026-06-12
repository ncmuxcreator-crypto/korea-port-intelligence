import { archiveRawToGDrive } from "./lib/gdrive.js";

const result = await archiveRawToGDrive({
  check: "korea-port-intelligence-google-drive-archive",
  generated_at: new Date().toISOString(),
  note: "Small upload test for Korea Port Intelligence raw data archive."
}, { namePrefix: "korea-port-intelligence-gdrive-check" });

console.log(JSON.stringify(result, null, 2));

if (!["uploaded", "disabled"].includes(result.status)) {
  process.exitCode = 1;
}
