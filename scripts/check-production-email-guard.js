const {spawn}=require("node:child_process");
const {once}=require("node:events");
const http=require("node:http");
const path=require("node:path");
const db=require("../database");
const port=3215,base=`http://127.0.0.1:${port}`,email=`production.guard.${Date.now()}@example.com`;
const environment={...process.env,PORT:String(port),NODE_ENV:"development",EMAIL_PROVIDER:"development",ZOHO_CLIENT_ID:"",ZOHO_CLIENT_SECRET:"",ZOHO_REFRESH_TOKEN:"",ZOHO_FROM_EMAIL:"",OTP_SECRET:""};delete environment.RESEND_API_KEY;delete environment.RAILWAY_PROJECT_ID;delete environment.RAILWAY_SERVICE_ID;delete environment.RAILWAY_ENVIRONMENT_ID;delete environment.RAILWAY_ENVIRONMENT;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const registerFromPublicHost=payload=>new Promise((resolve,reject)=>{const body=JSON.stringify(payload),request=http.request({hostname:"127.0.0.1",port,path:"/api/register",method:"POST",headers:{Host:"deployed.example.com","Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}},response=>{response.resume();response.on("end",()=>resolve(response.statusCode))});request.on("error",reject);request.end(body)});
const server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:environment,stdio:"ignore",windowsHide:true});

(async()=>{
  try{
    let health;
    for(let index=0;index<30;index++){try{const response=await fetch(`${base}/api/health`);health={status:response.status,payload:await response.json()};break}catch{}await wait(150)}
    if(health?.status!==200)throw new Error("Local test server did not start.");
    const status=await registerFromPublicHost({firstName:"Production",lastName:"Guard",email,phone:"+1 555 010 8831",loginCode:"483920",loginCodeConfirmation:"483920",country:"Nigeria",currency:"USD"});
    if(status!==503)throw new Error(`Public registration exposed a development verification path (${status}).`);
    if(db.prepare("SELECT 1 FROM users WHERE email=?").get(email))throw new Error("Failed production registration left an unusable account behind.");
    console.log("PASS public hosts refuse development verification codes even without deployment environment markers");
  }finally{server.kill();await Promise.race([once(server,"exit"),wait(1500)]);const user=db.prepare("SELECT id FROM users WHERE email=?").get(email);if(user)db.prepare("DELETE FROM users WHERE id=?").run(user.id)}
})().catch(error=>{console.error(error);process.exitCode=1});
