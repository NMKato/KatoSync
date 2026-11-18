// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {retainedMeshSelection} from "../src/lib/meshConnectionState.ts";
import {canSelectLocallyApprovedPeerForQa} from "../src/lib/meshPairedSelection4X.ts";

const source=readFileSync(new URL("../src/components/MeshConnectionCard.tsx",import.meta.url),"utf8");
function between(from:string,to:string){
  const begin=source.indexOf(from),end=source.indexOf(to,begin);
  assert.ok(begin>=0&&end>begin,"production async block must exist");
  return source.slice(begin,end);
}
// Execute the actual production handlers/effect; only native I/O, React effect
// scheduling and timers are controlled. No duplicate state-machine model.
const foreground=between("  const loadAccountDirectory=","  const recoverPairing=");
const background=between("  // Stage 3.5: authenticated first-start auto-introduction","  const startConnectionGuide=");
const guide=between("  const startConnectionGuide=","  // Stage 3I is available");
const refreshState=source.match(/const \[bootstrapRefreshEpoch,setBootstrapRefreshEpoch\]=useState\(0\);/)?.[0]??"";
const fingerprint=(byte:string)=>Array(16).fill(byte).join("-");
const agent=(byte="AA")=>({
  protocol:"katosync-mesh-agent-bootstrap-v35",agentName:"KAI",
  fingerprint:fingerprint(byte),ownerSessionVerified:true,rosterDiscoveryAllowed:true,
  transportReady:false,remoteJobsEnabled:false
});
const peer={deviceId:"peer",ownerUserId:"owner",displayName:"Other Mac",
  platformOs:"macos",membershipState:"trusted",fingerprint:fingerprint("BB")};
const roster=(tag:string,byte="AA")=>({
  accountVerified:true,discoveryOnly:true,transportReady:false,remoteJobsEnabled:false,tag,
  devices:[{...peer,deviceId:"self",displayName:"This Mac",fingerprint:fingerprint(byte)},peer]
});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

function harness(){
  const state:any={directory:null,agentBootstrap:null,selectedDeviceId:null,
    directoryBusy:false,directoryError:false,refreshEpoch:0,bootstrapRefreshEpoch:0};
  const requests:any[]=[],commands:string[]=[],timers=new Map<number,{callback:()=>void,delay:number}>();
  let timerId=0,renderPending=false,cleanup:(()=>void)|undefined,dependencies:any[]|undefined;
  let handlers:any;
  const refs:any=Object.fromEntries([
    "rosterOperation","nativePreflightOperation","challengeOperation","lastPresenceAttempt"
  ].map(key=>[key,{current:0}]));
  for(const key of ["rosterInFlight","nativePreflightInFlight","challengeInFlight",
    "inboxInFlight","recipientInFlight","relayInFlight"])refs[key]={current:false};
  refs.presenceIdentity={current:""};
  const set=(key:string)=>(value:any)=>{
    const next=typeof value==="function"?value(state[key]):value;
    if(next!==state[key]){state[key]=next;renderPending=true;}
  };
  const noop=()=>{};
  const scope:any={
    ...refs,retainedMeshSelection,easySession:null,
    testEnv:{VITE_KATOOS_AUTH_QA:"1",VITE_STAGE35_HEARTBEAT_QA:"0"},
    invoke:(command:string)=>{
      commands.push(command);
      return new Promise((resolve,reject)=>requests.push({command,resolve,reject}));
    },
    window:{
      setTimeout:(callback:()=>void,delay:number)=>{
        const id=++timerId;timers.set(id,{callback,delay});return id;
      },
      clearTimeout:(id:number)=>timers.delete(id)
    },
    useState:()=>[state.bootstrapRefreshEpoch,set("bootstrapRefreshEpoch")],
    setDirectory:set("directory"),setAgentBootstrap:set("agentBootstrap"),
    setSelectedDeviceId:set("selectedDeviceId"),setDirectoryBusy:set("directoryBusy"),
    setDirectoryError:set("directoryError"),setDirectoryIssue:noop,setGuideOpen:noop,
    setNativePreflight:noop,setNativePreflightError:noop,setNativePreflightBusy:noop,
    resetRelay:noop,setAcceptedInboxOffer:noop,setAcceptedChallenge:noop,
    setChallengeBusy:noop,setChallengeError:noop,setNativeInboxSent:noop,setNativeInboxPrepared:noop
  };
  scope.useEffect=(effect:()=>()=>void,next:any[])=>{
    if(dependencies&&next.every((value,index)=>Object.is(value,dependencies![index])))return;
    cleanup?.();dependencies=next;cleanup=effect();
  };
  const names=[...Object.keys(scope),...Object.keys(state)].filter(key=>key!=="bootstrapRefreshEpoch");
  const program="const {"+names.join(",")+"}=scope;\n"+refreshState+"\n"+
    foreground+background+guide+"\nreturn {loadAccountDirectory,startConnectionGuide};";
  const renderFunction=new Function("return "+stripTypeScriptTypes(
    "(scope)=>{"+program.replaceAll("import.meta.env","testEnv")+"}"))();
  const render=()=>{renderPending=false;handlers=renderFunction({...scope,...state});};
  const flush=async()=>{
    await tick();
    for(let i=0;renderPending;i++){
      assert.ok(i<10,"effect must settle without a render loop");
      render();await tick();
    }
  };
  const take=(command:string)=>{
    const request=requests.shift();
    assert.equal(request?.command,command,"expected immediate native read: "+command);
    return request;
  };
  const resolve=async(request:any,value:any)=>{request.resolve(value);await flush();};
  const reply=async(command:string,value:any)=>resolve(take(command),value);
  const beginBackground=async()=>{
    await reply("supabase_session_status",{loggedIn:true});
    await reply("mesh_agent_bootstrap_snapshot",agent());
    return take("mesh_account_devices_list");
  };
  const finishFreshBootstrap=async(finalAgent=agent())=>{
    await reply("supabase_session_status",{loggedIn:true});
    await reply("mesh_agent_bootstrap_snapshot",agent());
    await reply("mesh_account_devices_list",roster("fresh"));
    await reply("mesh_agent_bootstrap_snapshot",finalAgent);
  };
  const selectable=()=>canSelectLocallyApprovedPeerForQa({
    enabled:true,peer,approvedPeers:[{fingerprint:peer.fingerprint,status:"locally_approved"}],
    ownFingerprint:state.agentBootstrap?.fingerprint??null
  });
  render();
  return {state,requests,commands,timers,take,resolve,reply,flush,beginBackground,
    finishFreshBootstrap,selectable,
    connect:()=>handlers.startConnectionGuide(),
    selectPeer:()=>{state.selectedDeviceId=peer.deviceId;render();},
    invalidateOwner:()=>{
      // Existing account/surface refresh invalidates outstanding foreground work.
      refs.rosterOperation.current++;refs.rosterInFlight.current=false;
      state.directory=null;state.selectedDeviceId=null;state.directoryBusy=false;
      state.refreshEpoch++;render();
    },
    cleanup:()=>cleanup?.()
  };
}

test("first Connect retries a displaced bootstrap immediately, without advancing the 120s timer",async()=>{
  const h=harness();
  try{
    const old=await h.beginBackground();
    h.connect();
    const manual=h.take("mesh_account_devices_list");
    await h.resolve(old,roster("obsolete"));
    assert.equal(h.state.agentBootstrap,null);
    assert.equal(h.selectable(),false);
    assert.deepEqual([...h.timers.values()].map(timer=>timer.delay),[120_000]);
    await h.resolve(manual,roster("manual"));
    assert.equal(h.state.directoryBusy,false);
    await h.finishFreshBootstrap();
    assert.equal(h.state.directory.tag,"fresh");
    assert.equal(h.state.agentBootstrap.fingerprint,agent().fingerprint);
    assert.equal(h.selectable(),true);
    assert.ok(h.commands.every(command=>[
      "supabase_session_status","mesh_agent_bootstrap_snapshot","mesh_account_devices_list"
    ].includes(command)),"Connect must not enroll, invite, approve or start a transport");
  }finally{h.cleanup();}
});

test("late background success cannot replace the fresh account snapshot or create a second timer",async()=>{
  const h=harness();
  try{
    const old=await h.beginBackground();
    h.connect();
    await h.reply("mesh_account_devices_list",roster("manual"));
    await h.finishFreshBootstrap();
    const calls=h.commands.length,timerCount=h.timers.size;
    await h.resolve(old,roster("obsolete","CC"));
    assert.equal(h.state.directory.tag,"fresh");
    assert.equal(h.state.agentBootstrap.fingerprint,agent().fingerprint);
    assert.equal(h.commands.length,calls);
    assert.equal(h.timers.size,timerCount);
  }finally{h.cleanup();}
});

test("account refresh and logout fence out a late foreground result and its retry trigger",async()=>{
  const h=harness();
  try{
    const old=await h.beginBackground();
    h.connect();
    const manual=h.take("mesh_account_devices_list");
    h.invalidateOwner();
    await h.reply("supabase_session_status",{loggedIn:false});
    await h.resolve(manual,roster("old-account"));
    await h.resolve(old,roster("old-background"));
    assert.equal(h.state.directory,null);
    assert.equal(h.state.agentBootstrap,null);
    assert.equal(h.state.bootstrapRefreshEpoch,0);
    assert.equal(h.requests.length,0);
    assert.equal(h.selectable(),false);
  }finally{h.cleanup();}
});

test("fresh bootstrap still rejects an owner identity change during roster I/O",async()=>{
  const h=harness();
  try{
    const old=await h.beginBackground();
    h.connect();
    await h.reply("mesh_account_devices_list",roster("manual"));
    await h.finishFreshBootstrap(agent("CC"));
    await h.resolve(old,roster("obsolete"));
    assert.equal(h.state.agentBootstrap,null);
    assert.equal(h.state.directory.tag,"manual");
    assert.equal(h.selectable(),false);
  }finally{h.cleanup();}
});

test("double Connect stays single-flight and a failed read creates no success retry",async()=>{
  const h=harness();
  try{
    const old=await h.beginBackground();
    h.connect();h.connect();
    const manual=h.take("mesh_account_devices_list");
    assert.equal(h.requests.length,0);
    manual.reject(new Error("MESH_DIRECTORY_UNAVAILABLE"));
    await h.flush();
    await h.resolve(old,roster("obsolete"));
    assert.equal(h.state.directoryError,true);
    assert.equal(h.state.directoryBusy,false);
    assert.equal(h.state.bootstrapRefreshEpoch,0);
    assert.equal(h.state.agentBootstrap,null);
    assert.equal(h.selectable(),false);
  }finally{h.cleanup();}
});

test("an existing bootstrap gets one explicit revalidation, preserving selection without a retry loop",async()=>{
  const h=harness();
  try{
    await h.finishFreshBootstrap();
    h.selectPeer();
    const calls=h.commands.length;
    h.connect();
    await h.reply("mesh_account_devices_list",roster("manual"));
    await h.finishFreshBootstrap();
    await h.flush();
    assert.deepEqual(h.commands.slice(calls),[
      "mesh_account_devices_list","supabase_session_status",
      "mesh_agent_bootstrap_snapshot","mesh_account_devices_list","mesh_agent_bootstrap_snapshot"
    ]);
    assert.equal(h.state.bootstrapRefreshEpoch,1);
    assert.equal(h.state.selectedDeviceId,peer.deviceId);
    assert.equal(h.state.agentBootstrap.fingerprint,agent().fingerprint);
    assert.equal(h.requests.length,0);
    assert.deepEqual([...h.timers.values()].map(timer=>timer.delay),[120_000]);
  }finally{h.cleanup();}
});
