const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");

const envPath=path.join(__dirname,"..",".env"),appUrlArgument=process.argv.find(value=>value.startsWith("--app-url=")),appUrl=String(appUrlArgument?.slice(10)||"").replace(/\/$/,"");
if(!fs.existsSync(envPath)){console.error("FAIL Create .env first.");process.exit(1)}
if(!/^https:\/\//i.test(appUrl)){console.error("FAIL Pass the production URL as --app-url=https://example.com");process.exit(1)}

process.loadEnvFile(envPath);
const placeholder=value=>!value||/^(your_|generate_|change_|<)|@example\.com$/i.test(String(value).trim());
const setValue=(source,key,value)=>{const clean=String(value).replace(/\r?\n/g,""),pattern=new RegExp(`^${key}=.*$`,"m");return pattern.test(source)?source.replace(pattern,`${key}=${clean}`):`${source.replace(/\s*$/,"")}\n${key}=${clean}\n`};
let source=fs.readFileSync(envPath,"utf8"),generated=[];
source=setValue(source,"APP_URL",appUrl);
if(placeholder(process.env.OTP_SECRET)){source=setValue(source,"OTP_SECRET",crypto.randomBytes(48).toString("base64url"));generated.push("OTP_SECRET")}
if(placeholder(process.env.ADMIN_EMAIL)){source=setValue(source,"ADMIN_EMAIL",process.env.ZOHO_FROM_EMAIL);generated.push("ADMIN_EMAIL")}
if(placeholder(process.env.ADMIN_PASSWORD)){source=setValue(source,"ADMIN_PASSWORD",crypto.randomBytes(30).toString("base64url"));generated.push("ADMIN_PASSWORD")}
fs.writeFileSync(envPath,source,{encoding:"utf8",mode:0o600});
console.log(`PASS Production environment prepared${generated.length?`; generated ${generated.join(", ")}`:"; existing secrets preserved"}.`);
console.log("Values remain only in the ignored .env file.");
