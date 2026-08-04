const {spawn}=require("node:child_process");
const {once}=require("node:events");
const {DatabaseSync}=require("node:sqlite");
const crypto=require("node:crypto");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");

const stamp=Date.now(),port=3221,base=`http://127.0.0.1:${port}`,databasePath=path.join(os.tmpdir(),`stockprime-email-${stamp}.sqlite`),email=`email.flow.${stamp}@example.com`,oldCode="482615",newCode="739204";
const environment={...process.env,PORT:String(port),NODE_ENV:"development",DATABASE_PATH:databasePath,EMAIL_PROVIDER:"",RESEND_API_KEY:"",OTP_SECRET:"email-flow-test-secret",ADMIN_EMAIL:"email-admin@example.com",ADMIN_PASSWORD:"EmailAdmin123!"};
const server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:environment,stdio:"ignore",windowsHide:true});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const post=(url,payload,cookie="")=>fetch(`${base}${url}`,{method:"POST",headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(payload)});
let db;

(async()=>{
  try{
    let healthy=false;for(let index=0;index<40;index++){try{healthy=(await fetch(`${base}/api/health`)).ok;if(healthy)break}catch{}await wait(150)}if(!healthy)throw new Error("Test server did not become ready.");
    db=new DatabaseSync(databasePath);
    const registration=await post("/api/register",{firstName:"Email",lastName:"Flow",email,phone:"+1 555 010 9123",loginCode:oldCode,loginCodeConfirmation:oldCode,country:"Nigeria",currency:"USD"}),created=await registration.json();if(registration.status!==201)throw new Error(`Registration failed: ${JSON.stringify(created)}`);
    const confirmation=await post("/api/auth/verify-registration",{email,code:created.developmentCode}),confirmed=await confirmation.json();if(confirmation.status!==200)throw new Error(`Confirmation failed: ${JSON.stringify(confirmed)}`);const cookie=String(confirmation.headers.get("set-cookie")||"").split(";")[0];

    const user=db.prepare("SELECT id FROM users WHERE email=?").get(email),token="email-flow-reset-token",timestamp=new Date().toISOString(),expires=new Date(Date.now()+1800000).toISOString();db.prepare("INSERT INTO password_reset_tokens (user_id,token_hash,expires_at,requested_ip,created_at) VALUES (?,?,?,?,?)").run(user.id,crypto.createHash("sha256").update(token).digest("hex"),expires,"127.0.0.1",timestamp);
    const reset=await post("/api/password/reset",{token,loginCode:newCode,loginCodeConfirmation:newCode}),resetData=await reset.json();if(reset.status!==200)throw new Error(`Login-code reset failed: ${JSON.stringify(resetData)}`);
    const login=await post("/api/login",{email,loginCode:newCode});if(login.status!==200)throw new Error("The new login code was not accepted.");

    const authenticated=await post("/api/login",{email,loginCode:newCode}),challenge=await authenticated.json(),verifiedLogin=await post("/api/auth/verify-login",{email,code:challenge.developmentCode}),verifiedData=await verifiedLogin.json();if(verifiedLogin.status!==200)throw new Error(`Verified login failed: ${JSON.stringify(verifiedData)}`);const activeCookie=String(verifiedLogin.headers.get("set-cookie")||"").split(";")[0];
    const deposit=await post("/api/wallet/deposits",{amount:250,method:"Bank Transfer",reference:`EMAILTEST${stamp}`},activeCookie),depositData=await deposit.json();if(deposit.status!==201)throw new Error(`Deposit failed: ${JSON.stringify(depositData)}`);
    db.prepare("UPDATE wallets SET available_cents=50000 WHERE user_id=?").run(user.id);
    const withdrawal=await post("/api/wallet/withdrawals",{amount:25,method:"Bank Transfer",destination:"TEST-DESTINATION-001"},activeCookie),withdrawalData=await withdrawal.json();if(withdrawal.status!==201)throw new Error(`Withdrawal failed: ${JSON.stringify(withdrawalData)}`);

    const adminLogin=await post("/api/admin/login",{email:"email-admin@example.com",password:"EmailAdmin123!"}),adminData=await adminLogin.json();if(adminLogin.status!==200)throw new Error(`Admin login failed: ${JSON.stringify(adminData)}`);const adminCookie=String(adminLogin.headers.get("set-cookie")||"").split(";")[0];
    const notification=await post("/api/admin/notifications",{title:"Email system check",message:"This notification verifies email delivery wiring.",category:"account",recipient:email},adminCookie),notificationData=await notification.json();if(notification.status!==201||notificationData.email?.failed!==1)throw new Error(`Notification email audit failed: ${JSON.stringify(notificationData)}`);

    const kinds=db.prepare("SELECT kind,status FROM email_deliveries ORDER BY id").all(),requiredKinds=["registration_code","welcome","login_code_changed","login_code","deposit_pending","withdrawal_pending","notification_account"];
    for(const kind of requiredKinds)if(!kinds.some(row=>row.kind===kind))throw new Error(`Missing audited email kind: ${kind}`);
    console.log(`PASS login-code reset, deposit, withdrawal, and admin notification email flows (${kinds.length} audited deliveries)`);
  }finally{
    if(db)db.close();server.kill();await Promise.race([once(server,"exit"),wait(1500)]);for(const suffix of ["","-shm","-wal"]){try{fs.unlinkSync(`${databasePath}${suffix}`)}catch{}}
  }
})().catch(error=>{console.error(error);process.exitCode=1});
