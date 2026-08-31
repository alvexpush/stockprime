const {spawn}=require("node:child_process");
const {once}=require("node:events");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");

const port=3223,base=`http://127.0.0.1:${port}`,databasePath=path.join(os.tmpdir(),`vanguardprime-package-crud-${process.pid}.sqlite`);
const environment={...process.env,PORT:String(port),DATABASE_PATH:databasePath,NODE_ENV:"development",EMAIL_PROVIDER:"development",ADMIN_EMAIL:"package-admin@example.com",ADMIN_PASSWORD:"PackageAdmin123!"};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server;
const request=async(url,options={})=>{const response=await fetch(base+url,options),data=await response.json();if(!response.ok)throw new Error(data.error||`${options.method||"GET"} ${url} failed.`);return data};

async function start(){server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:environment,stdio:"ignore",windowsHide:true});for(let attempt=0;attempt<40;attempt++){try{if((await fetch(`${base}/api/health`)).ok)return}catch{}await wait(150)}throw new Error("Application server did not start.")}
async function stop(){if(!server)return;server.kill();await Promise.race([once(server,"exit"),wait(1500)]);server=null}

(async()=>{
  try{
    await start();
    const login=await fetch(`${base}/api/admin/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:environment.ADMIN_EMAIL,password:environment.ADMIN_PASSWORD})});
    if(!login.ok)throw new Error("Admin login failed.");
    const cookie=String(login.headers.get("set-cookie")||"").split(";")[0],headers={"Content-Type":"application/json",Cookie:cookie};
    const initial=await request("/api/admin/investment-plans",{headers:{Cookie:cookie}});
    for(const type of ["Basic","Gold","Platinum","Diamond"]){if(initial.plans.filter(plan=>plan.status==="active"&&plan.category===type).length!==3)throw new Error(`${type} does not contain three default packages.`)}
    const create=await request("/api/admin/investment-plans",{method:"POST",headers,body:JSON.stringify({name:"Custom Flex",category:"Custom",nav:10,minInvestment:50,maxInvestment:5000,dailyReturn:2.5,durationDays:18,returnRate:45,managementFee:1,risk:"Medium",status:"Active",description:"CRUD verification package"})});
    let plans=(await request("/api/admin/investment-plans",{headers:{Cookie:cookie}})).plans,created=plans.find(plan=>plan.public_id===create.planId);
    if(!created||created.duration_days!==18||created.category!=="Custom")throw new Error("Created package was not returned with its configured values.");
    await request("/api/admin/investment-plans",{method:"POST",headers,body:JSON.stringify({id:create.planId,name:"Custom Flex Plus",category:"Custom",nav:10,minInvestment:75,maxInvestment:7500,dailyReturn:3,durationDays:27,returnRate:81,managementFee:1.5,risk:"High",status:"Active",description:"Updated CRUD verification package"})});
    created=(await request("/api/investment-plans")).plans.find(plan=>plan.public_id===create.planId);
    if(!created||created.duration_days!==27||created.minimum_cents!==7500)throw new Error("Updated package values did not reach the customer API.");
    const removed=await request(`/api/admin/investment-plans/${encodeURIComponent(create.planId)}`,{method:"DELETE",headers:{Cookie:cookie}});
    if(!removed.deleted||(await request("/api/admin/investment-plans",{headers:{Cookie:cookie}})).plans.some(plan=>plan.public_id===create.planId))throw new Error("Unused package was not deleted.");
    console.log("PASS investment packages support grouped defaults and complete create/read/update/delete flow");
  }finally{await stop();for(const suffix of ["","-shm","-wal"]){try{fs.rmSync(databasePath+suffix,{force:true})}catch{}}}
})().catch(error=>{console.error(error);process.exitCode=1});
