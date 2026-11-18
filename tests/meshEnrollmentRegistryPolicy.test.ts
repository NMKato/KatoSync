// Created by NMKato Solutions – pure registry policy, no network/credentials.
import {test} from "node:test";
import assert from "node:assert/strict";
import {inspectEnrollmentRegistry} from "../supabase/functions/mesh-device-enrollment/registry-policy.ts";

const key="A".repeat(43);
const live={signing_public_key:key,membership_state:"trusted",revoked_at:null};

test("new and existing keys are classified independently from actual Mesh trust",()=>{
 assert.deepEqual(inspectEnrollmentRegistry([],key),{kind:"new",count:0});
 assert.deepEqual(inspectEnrollmentRegistry([live],key),{kind:"known",count:1});
 assert.deepEqual(inspectEnrollmentRegistry([live], "B".repeat(43)),{kind:"new",count:1});
});
test("a previously revoked device cannot be silently rediscovered",()=>{
 assert.deepEqual(inspectEnrollmentRegistry([{
  ...live,membership_state:"revoked",revoked_at:"2026-10-28T16:00:00Z"
 }],key),{kind:"revoked"});
});
test("inconsistent or forged backend membership data fail closed",()=>{
 for(const invalid of [
  [{...live,membership_state:"revoked",revoked_at:null}],
  [{...live,membership_state:"trusted",revoked_at:"2026-10-28T16:00:00Z"}],
  [{...live,membership_state:"connected"}],
  [{...live,revoked_at:"garbage"}],
  [{...live,signing_public_key:null}],
  [null],
  Array.from({length:11},()=>live),
  [live,live],
 ]){
  // Only duplicate same-key rows are special; other corruption also invalid.
  assert.deepEqual(inspectEnrollmentRegistry(invalid,key),{kind:"invalid"});
 }
});
