const {spawn}=require("node:child_process");
const {once}=require("node:events");
const path=require("node:path");
const db=require("../database");
const port=3215,base=`http://127.0.0.1:${port}`,email=`production.guard.${Date.now()}@example.com`;
const environment={...process.env,PORT:String(port),NODE_ENV:"development",RAILWAY_PROJECT_ID:"railway-production-guard",EMAIL_PROVIDER:"development",ZOHO_CLIENT_ID:"",ZOHO_CLIENT_SECRET:"",ZOHO_REFRESH_TOKEN:"",ZOHO_FROM_EMAIL:"",OTP_SECRET:""};delete environment.RESEND_API_KEY;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:environment,stdio:"ignore",windowsHide:true});

(async()=>{
  try{
    let health;
    for(let index=0;index<30;index++){try{const response=await fetch(`${base}/api/health`);health={status:response.status,payload:await response.json()};break}catch{}await wait(150)}
    if(health?.status!==503||health.payload?.email?.configured!==false)throw new Error("Production health did not reject missing email configuration.");
    const response=await fetch(`${base}/api/register`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({firstName:"Production",lastName:"Guard",email,phone:"+1 555 010 8831",loginCode:"483920",loginCodeConfirmation:"483920",country:"Nigeria",currency:"USD"})});
    if(response.status!==503)throw new Error(`Production registration bypassed unavailable email delivery (${response.status}).`);
    if(db.prepare("SELECT 1 FROM users WHERE email=?").get(email))throw new Error("Failed production registration left an unusable account behind.");
    console.log("PASS Railway refuses development codes when Zoho/OTP secrets are missing and leaves no orphan account");
  }finally{server.kill();await Promise.race([once(server,"exit"),wait(1500)]);const user=db.prepare("SELECT id FROM users WHERE email=?").get(email);if(user)db.prepare("DELETE FROM users WHERE id=?").run(user.id)}
})().catch(error=>{console.error(error);process.exitCode=1});
