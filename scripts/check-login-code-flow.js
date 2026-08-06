const {spawn}=require("node:child_process");
const {once}=require("node:events");
const path=require("node:path");
const db=require("../database");
const port=3197,base=`http://127.0.0.1:${port}`,email=`login.code.${Date.now()}@example.com`,loginCode="482615";
const environment={...process.env,PORT:String(port),NODE_ENV:"development",EMAIL_PROVIDER:"development",RESEND_API_KEY:"re_test_must_not_be_used"};
const server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:environment,stdio:"ignore",windowsHide:true});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const post=(url,payload)=>fetch(`${base}${url}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});

(async()=>{
  try{
    for(let index=0;index<30;index++){try{if((await fetch(`${base}/api/health`)).ok)break}catch{}await wait(150)}
    const registration=await post("/api/register",{firstName:"Login",lastName:"Code Test",email,phone:"+1 555 010 9090",loginCode,loginCodeConfirmation:loginCode,country:"Nigeria",currency:"USD"}),created=await registration.json();
    if(registration.status!==201||created.verificationRequired!==true||!/^\d{6}$/.test(created.developmentCode||""))throw new Error(`Registration verification failed: ${JSON.stringify(created)}`);
    if(db.prepare("SELECT email_verified_at FROM users WHERE email=?").get(email)?.email_verified_at!==null)throw new Error("Registration marked the email verified before confirmation.");
    const badConfirmation=await post("/api/auth/verify-registration",{email,code:"000000"});
    if(badConfirmation.status!==422)throw new Error("Incorrect registration email code was accepted.");
    const confirmation=await post("/api/auth/verify-registration",{email,code:created.developmentCode}),confirmed=await confirmation.json();
    if(confirmation.status!==200||!confirmed.user||confirmed.user.emailVerified!==true||confirmed.user.kycStatus!=="not_submitted")throw new Error(`Email confirmation state failed: ${JSON.stringify(confirmed)}`);
    const cookie=confirmation.headers.get("set-cookie")?.split(";")[0];if(!cookie)throw new Error("Email confirmation did not create an authenticated session.");
    const kycBefore=await fetch(`${base}/api/kyc`,{headers:{Cookie:cookie}}),initialKyc=await kycBefore.json();if(kycBefore.status!==200||initialKyc.emailVerified!==true||initialKyc.status!=="not_submitted")throw new Error(`Initial KYC state failed: ${JSON.stringify(initialKyc)}`);
    const kycSubmission=await fetch(`${base}/api/kyc`,{method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie},body:JSON.stringify({firstName:"Login",lastName:"Code Test",dateOfBirth:"1990-01-01",nationality:"Nigerian",documentType:"Passport",documentNumber:"A12345678",documentFrontName:"passport.pdf",selfieName:"selfie.jpg",address:"1 Test Avenue",city:"Lagos",country:"Nigeria"})}),submittedKyc=await kycSubmission.json();if(kycSubmission.status!==201||submittedKyc.status!=="pending")throw new Error(`KYC submission failed: ${JSON.stringify(submittedKyc)}`);
    const wrongLogin=await post("/api/login",{email,loginCode:"000000"});
    if(wrongLogin.status!==401)throw new Error("Incorrect private login code was accepted.");
    const login=await post("/api/login",{email,loginCode}),challenge=await login.json();
    if(login.status!==200||challenge.verificationRequired!==true||challenge.purpose!=="login"||!/^\d{6}$/.test(challenge.developmentCode||""))throw new Error(`Login email challenge failed: ${JSON.stringify(challenge)}`);
    const loginConfirmation=await post("/api/auth/verify-login",{email,code:challenge.developmentCode}),signedIn=await loginConfirmation.json();
    if(loginConfirmation.status!==200||!signedIn.user)throw new Error(`Login confirmation failed: ${JSON.stringify(signedIn)}`);
    console.log({registration:registration.status,emailConfirmation:confirmation.status,initialKyc:initialKyc.status,kycSubmission:submittedKyc.status,wrongLoginCode:wrongLogin.status,loginChallenge:login.status,loginConfirmation:loginConfirmation.status});
  }finally{
    server.kill();await Promise.race([once(server,"exit"),wait(1500)]);
    const user=db.prepare("SELECT id FROM users WHERE email=?").get(email);if(user)db.prepare("DELETE FROM users WHERE id=?").run(user.id);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
