const {spawn}=require("node:child_process");
const {once}=require("node:events");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");

const port=3222,base=`http://127.0.0.1:${port}`,databasePath=path.join(os.tmpdir(),`vanguardprime-plan-edit-${process.pid}.sqlite`);
const environment={...process.env,PORT:String(port),DATABASE_PATH:databasePath,NODE_ENV:"development",EMAIL_PROVIDER:"development",ADMIN_EMAIL:"plan-admin@example.com",ADMIN_PASSWORD:"PlanAdmin123!"};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server;

async function start(){
  server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:environment,stdio:"ignore",windowsHide:true});
  for(let attempt=0;attempt<40;attempt++){try{await fetch(`${base}/api/health`);return}catch{}await wait(150)}
  throw new Error("Test server did not start.");
}
async function stop(){if(!server)return;server.kill();await Promise.race([once(server,"exit"),wait(1500)]);server=null}
async function adminCookie(){
  const response=await fetch(`${base}/api/admin/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:environment.ADMIN_EMAIL,password:environment.ADMIN_PASSWORD})});
  if(!response.ok)throw new Error(`Admin login failed (${response.status}).`);
  return String(response.headers.get("set-cookie")||"").split(";")[0];
}
async function plans(cookie){const response=await fetch(`${base}/api/admin/investment-plans`,{headers:{Cookie:cookie}}),data=await response.json();if(!response.ok)throw new Error(data.error||"Plans could not be loaded.");return data.plans}

(async()=>{
  try{
    await start();let cookie=await adminCookie(),plan=(await plans(cookie))[0];
    const update={id:plan.public_id,name:plan.name,category:plan.category,nav:plan.nav_cents/100,minInvestment:123.45,maxInvestment:9876.54,dailyReturn:4.25,durationDays:42,returnRate:178.5,managementFee:1.2,risk:"Medium",status:"Active",description:"Persistence test"};
    const response=await fetch(`${base}/api/admin/investment-plans`,{method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie},body:JSON.stringify(update)}),data=await response.json();
    if(!response.ok)throw new Error(data.error||"Plan update failed.");
    await stop();await start();cookie=await adminCookie();plan=(await plans(cookie)).find(item=>item.public_id===update.id);
    if(!plan||plan.minimum_cents!==12345||plan.maximum_cents!==987654||plan.daily_return_bps!==425||plan.duration_days!==42||plan.projected_return_bps!==17850)throw new Error("Edited plan values did not survive restart.");
    console.log("PASS admin can edit every customer-facing investment value and changes survive restart");
  }finally{
    await stop();
    for(const suffix of ["","-shm","-wal"]){try{fs.rmSync(databasePath+suffix,{force:true})}catch{}}
  }
})().catch(error=>{console.error(error);process.exitCode=1});
