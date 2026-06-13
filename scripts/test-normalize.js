#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildVesselMatchKeys,
  normalizeBerth,
  normalizeCallSign,
  normalizeDateTime,
  normalizeFlag,
  normalizeNumeric,
  normalizePort,
  normalizeVesselName,
  normalizeVesselType,
  pickAlias
} from "./lib/normalize.js";

const fixturePath = path.join(process.cwd(), "test", "fixtures", "normalization-samples.json");
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

for (const item of fixtures.vessel_names || []) {
  assert.equal(normalizeVesselName(item.input), item.expected, `vessel_name ${item.input}`);
}

for (const item of fixtures.call_signs || []) {
  assert.equal(normalizeCallSign(item.input), item.expected, `call_sign ${item.input}`);
}

for (const item of fixtures.ports || []) {
  assert.equal(normalizePort(item.input).normalized_port, item.expected_normalized_port, `port ${item.input}`);
}

for (const item of fixtures.date_times || []) {
  const normalized = normalizeDateTime(item.input, item.context || {});
  assert.equal(normalized.parse_status, item.expected_parse_status, `date_time ${item.input}`);
  if (item.expected_time_only_missing_date !== undefined) {
    assert.equal(normalized.time_only_missing_date, item.expected_time_only_missing_date, `time_only ${item.input}`);
  }
}

for (const item of fixtures.berths || []) {
  const normalized = normalizeBerth(item.input);
  assert.equal(normalized.terminal, item.expected_terminal, `berth terminal ${item.input}`);
  assert.equal(normalized.berth, item.expected_berth, `berth ${item.input}`);
  assert.equal(normalized.normalized_berth, item.expected_normalized_berth, `normalized berth ${item.input}`);
}

for (const item of fixtures.vessel_spec_alias_rows || []) {
  const row = item.input;
  const normalized = {
    vessel_name: normalizeVesselName(pickAlias(row, "vessel_name")),
    call_sign: normalizeCallSign(pickAlias(row, "call_sign")),
    port: pickAlias(row, "port"),
    gt: normalizeNumeric(pickAlias(row, "gt")),
    vessel_type: normalizeVesselType(pickAlias(row, "vessel_type")),
    flag: normalizeFlag(pickAlias(row, "flag"))
  };
  const matchKeys = buildVesselMatchKeys({ ...row, ...normalized });
  assert.equal(normalized.call_sign, item.expected.call_sign, "vessel_spec call_sign");
  assert.equal(normalized.vessel_name, item.expected.vessel_name, "vessel_spec vessel_name");
  assert.equal(normalized.gt, item.expected.gt, "vessel_spec gt");
  assert.equal(normalized.vessel_type, item.expected.vessel_type, "vessel_spec vessel_type");
  assert.equal(normalized.flag, item.expected.flag, "vessel_spec flag");
  assert.equal(matchKeys.call_sign_port, item.expected.match_key_call_sign_port, "vessel_spec call_sign_port match key");
}

console.log("Normalization tests passed");
