const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");

const envPath=path.join(__dirname,"..",".env");
if(!fs.existsSync(envPath)){console.error("FAIL Create .env from .env.example first.");process.exit(1)}
process.loadEnvFile(envPath);

const required=["ZOHO_CLIENT_ID","ZOHO_CLIENT_SECRET","ZOHO_GRANT_CODE"],missing=required.filter(key=>!String(process.env[key]||"").trim());
if(missing.length){console.error(`FAIL Missing ${missing.join(", ")} in .env.`);process.exit(1)}
const accountsBase=String(process.env.ZOHO_ACCOUNTS_URL||"https://accounts.zoho.com").replace(/\/$/,"");

function setEnvValue(source,key,value){const escaped=String(value).replace(/\r?\n/g,"");const pattern=new RegExp(`^${key}=.*$`,"m");return pattern.test(source)?source.replace(pattern,`${key}=${escaped}`):`${source.replace(/\s*$/,"")}\n${key}=${escaped}\n`}

(async()=>{
  const response=await fetch(`${accountsBase}/oauth/v2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:process.env.ZOHO_CLIENT_ID,client_secret:process.env.ZOHO_CLIENT_SECRET,grant_type:"authorization_code",code:process.env.ZOHO_GRANT_CODE}),signal:AbortSignal.timeout(15000)}),data=await response.json();
  if(!response.ok||!data.refresh_token)throw new Error(`Zoho grant exchange failed${data.error?`: ${data.error}`:"."}`);
  let source=fs.readFileSync(envPath,"utf8");source=setEnvValue(source,"ZOHO_REFRESH_TOKEN",data.refresh_token);source=setEnvValue(source,"ZOHO_GRANT_CODE","");
  if(!process.env.OTP_SECRET||/^(generate_|your_|change_|<)/i.test(process.env.OTP_SECRET))source=setEnvValue(source,"OTP_SECRET",crypto.randomBytes(48).toString("base64url"));
  fs.writeFileSync(envPath,source,{encoding:"utf8",mode:0o600});
  console.log("PASS Zoho refresh token saved to the ignored .env file; the one-time grant code was cleared.");
  console.log("Next: npm run email:check");
})().catch(error=>{console.error(`FAIL ${error.message}`);process.exitCode=1});
