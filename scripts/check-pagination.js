const {spawn}=require("node:child_process");
const {DatabaseSync}=require("node:sqlite");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");

const port=3225;
const base=`http://127.0.0.1:${port}`;
const databasePath=path.join(os.tmpdir(),`vanguardprime-pagination-${process.pid}.sqlite`);
const adminEmail="pagination.admin@example.com";
const adminPassword="Pagination123!";
const server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:{...process.env,PORT:String(port),DATABASE_PATH:databasePath,ADMIN_EMAIL:adminEmail,ADMIN_PASSWORD:adminPassword},stdio:"ignore",windowsHide:true});
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

(async()=>{
  try{
    for(let attempt=0;attempt<40;attempt++){
      try{if((await fetch(`${base}/api/health`)).ok)break}catch{}
      await wait(150);
    }
    const db=new DatabaseSync(databasePath),insert=db.prepare("INSERT INTO users (public_id,name,email,password_hash,country,currency,status,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,'USD','active',?,?,?)"),timestamp=new Date().toISOString();
    for(let index=0;index<125;index++)insert.run(`USR-PAGE-${index}`,`Pagination User ${index}`,`pagination.${index}@example.com`,`test-hash-${index}`,"Nigeria",timestamp,timestamp,timestamp);
    db.close();
    const login=await fetch(`${base}/api/admin/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:adminEmail,password:adminPassword})});
    if(!login.ok)throw new Error(`Admin login returned ${login.status}.`);
    const cookie=login.headers.get("set-cookie").split(";",1)[0];
    const response=await fetch(`${base}/api/admin/users?limit=10&offset=10`,{headers:{Cookie:cookie}}),data=await response.json();
    if(!response.ok)throw new Error(data.error||`Users endpoint returned ${response.status}.`);
    if(data.users.length!==10||data.pagination.limit!==10||data.pagination.offset!==10||!data.pagination.hasMore)throw new Error("Users endpoint did not return the requested bounded page.");
    const cappedResponse=await fetch(`${base}/api/admin/users?limit=1000`,{headers:{Cookie:cookie}}),capped=await cappedResponse.json();
    if(capped.users.length!==100||capped.pagination.limit!==100||!capped.pagination.hasMore)throw new Error("Users endpoint did not enforce the 100-row maximum.");
    console.log("PASS growing data endpoints return bounded pages and enforce the maximum page size");
  }finally{
    server.kill();
    for(const suffix of ["","-wal","-shm"]){try{fs.rmSync(databasePath+suffix)}catch{}}
  }
})().catch(error=>{console.error(error);process.exitCode=1});
