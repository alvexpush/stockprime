const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const envPath=path.join(__dirname,".env");if(fs.existsSync(envPath))process.loadEnvFile(envPath);
const db = require("./database");

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const port = Number(process.env.PORT || 3000);
const productionRuntime=process.env.NODE_ENV==="production"||["RAILWAY_PROJECT_ID","RAILWAY_SERVICE_ID","RAILWAY_ENVIRONMENT_ID","RAILWAY_ENVIRONMENT"].some(key=>Boolean(process.env[key]));
const sessionDays = 7;
const mime = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".avif":"image/avif",".webp":"image/webp",".webm":"video/webm",".mp4":"video/mp4",".mov":"video/quicktime",".svg":"image/svg+xml",".ico":"image/x-icon",".txt":"text/plain; charset=utf-8"};
const now = () => new Date().toISOString();
const publicId = prefix => `${prefix}-${crypto.randomUUID()}`;
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const verificationCodeHash=value=>crypto.createHmac("sha256",process.env.OTP_SECRET||(productionRuntime?"missing-production-otp-secret":"stockprime-local-development")).update(value).digest("hex");
const cents = value => Math.round(Number(value) * 100);
const loginAttempts = new Map();
const adminSessions = new Map();
const quoteCache = new Map();
const newsCache = new Map();
const btcPriceCache = { value:null, cachedAt:0 };
const supportedStockSymbols = new Set(["AAPL","AMZN","GOOGL","JNJ","JPM","META","MSFT","NFLX","NVDA","TSLA"]);
const yearMs = 365.25 * 24 * 60 * 60 * 1000;
const verificationCodeMinutes = 10;
let zohoTokenCache = null;
let zohoAccountIdCache = null;

function elapsedYears(createdAt) {
  return Math.max(0, (Date.now() - new Date(createdAt).getTime()) / yearMs);
}
function projectedValue(principalCents, annualReturnBps, createdAt) {
  const principal = Number(principalCents) || 0;
  const profit = Math.round(principal * (Number(annualReturnBps) / 10000) * elapsedYears(createdAt));
  return { principalCents:principal, profitCents:profit, currentValueCents:principal + profit };
}
function investmentValue(order) {
  const principalCents=Number(order.amount_cents)||0;
  const durationDays=Math.max(1,Number(order.term_days||order.duration_days)||30);
  const elapsedDays=Math.max(0,(Date.now()-new Date(order.created_at).getTime())/86400000);
  const progress=Math.min(1,elapsedDays/durationDays);
  const fullProfit=Math.round(principalCents*(Number(order.projected_return_bps)||0)/10000);
  const profitCents=["completed"].includes(order.status)?fullProfit:Math.round(fullProfit*progress);
  return {principalCents,profitCents,currentValueCents:principalCents+profitCents,durationDays,progress};
}

async function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${Buffer.from(hash).toString("hex")}`;
}
async function passwordMatches(password, stored) {
  const [algorithm, saltHex, hashHex] = String(stored).split(":");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, "hex"), 64));
  const expected = Buffer.from(hashHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function json(res, status, payload, headers={}) {
  res.writeHead(status, {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers});
  res.end(JSON.stringify(payload));
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map(item => {
    const index = item.indexOf("=");
    return [item.slice(0,index).trim(), decodeURIComponent(item.slice(index+1))];
  }));
}
function sessionCookie(token) {
  const secure = productionRuntime ? "; Secure" : "";
  return `stockprime_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDays*86400}${secure}`;
}
function clearCookie() { return "stockprime_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"; }
function adminCookie(token) { return `stockprime_admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`; }
function clearAdminCookie() { return "stockprime_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"; }
function requestIp(req) { return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(); }
function setting(key, fallback="") { return db.prepare("SELECT value FROM platform_settings WHERE key=?").get(key)?.value ?? fallback; }
function settingNumber(key, fallback=0) { const value=Number(setting(key,fallback));return Number.isFinite(value)?value:fallback; }
function settingEnabled(key) { return setting(key,"0")==="1"; }
function referralCode() {
  let code;
  do code=`REF-${crypto.randomInt(100000,1000000)}`; while(db.prepare("SELECT 1 FROM users WHERE referral_code=?").get(code));
  return code;
}
async function body(req) {
  let value = "", size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    value += chunk;
  }
  if (!value) return {};
  try { return JSON.parse(value); } catch { throw Object.assign(new Error("Invalid JSON body."), { status: 400 }); }
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function currentUser(req) {
  const token = cookies(req).stockprime_session;
  if (!token) return null;
  return db.prepare(`
    SELECT u.id,u.public_id,u.name,u.email,u.country,u.currency,u.status,u.created_at,u.referral_code,u.phone,u.email_verified_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' AND u.email_verified_at IS NOT NULL
  `).get(sha256(token), now()) || null;
}
function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) json(res, 401, { error:"Authentication required." });
  return user;
}
function requireAdmin(req,res){
  const token=cookies(req).stockprime_admin_session,session=token&&adminSessions.get(sha256(token));
  if(!session||session.expiresAt<Date.now()){if(token)adminSessions.delete(sha256(token));json(res,401,{error:"Administrator authentication required."});return null}
  return session;
}
function validPassword(password){return password.length>=8&&/[A-Z]/.test(password)&&/[a-z]/.test(password)&&/\d/.test(password)}
function qualifyReferral(userId,investmentCents){
  const referral=db.prepare("SELECT * FROM referrals WHERE referred_user_id=? AND status='pending'").get(userId);
  if(!referral||investmentCents<settingNumber("referral_qualifying_investment_cents",10000))return;
  const affiliate=db.prepare("SELECT status FROM affiliates WHERE user_id=?").get(referral.referrer_user_id);
  const commission=affiliate?.status==="active"&&settingEnabled("affiliate_program_enabled")?Math.round(investmentCents*settingNumber("referral_commission_bps",1000)/10000):0;
  db.prepare("UPDATE referrals SET status='successful',investment_status='qualified',qualifying_investment_cents=?,commission_cents=?,qualified_at=? WHERE id=?").run(investmentCents,commission,now(),referral.id);
}
async function zohoAccessToken(force=false){
  if(!force&&zohoTokenCache?.expiresAt>Date.now()+60000)return zohoTokenCache.value;
  const required=["ZOHO_CLIENT_ID","ZOHO_CLIENT_SECRET","ZOHO_REFRESH_TOKEN"];
  const missing=required.filter(key=>!process.env[key]);if(missing.length)throw new Error(`Zoho Mail is missing ${missing.join(", ")}.`);
  const accountsBase=(process.env.ZOHO_ACCOUNTS_URL||"https://accounts.zoho.com").replace(/\/$/,"");
  const form=new URLSearchParams({refresh_token:process.env.ZOHO_REFRESH_TOKEN,client_id:process.env.ZOHO_CLIENT_ID,client_secret:process.env.ZOHO_CLIENT_SECRET,grant_type:"refresh_token"});
  const response=await fetch(`${accountsBase}/oauth/v2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(10000)}),data=await response.json();
  if(!response.ok||!data.access_token)throw new Error(`Zoho token refresh failed${data.error?`: ${data.error}`:"."}`);
  zohoTokenCache={value:data.access_token,expiresAt:Date.now()+Number(data.expires_in||3600)*1000};return zohoTokenCache.value;
}
async function sendZohoEmail({to,subject,html},retry=true){
  const fromAddress=process.env.ZOHO_FROM_EMAIL;
  if(!fromAddress)throw new Error("Zoho Mail requires ZOHO_FROM_EMAIL.");
  const token=await zohoAccessToken(!retry),mailBase=(process.env.ZOHO_MAIL_API_URL||"https://mail.zoho.com/api").replace(/\/$/,"");
  let accountId=process.env.ZOHO_ACCOUNT_ID||zohoAccountIdCache;
  if(!accountId){const accountsResponse=await fetch(`${mailBase}/accounts`,{headers:{"Authorization":`Zoho-oauthtoken ${token}`,"Accept":"application/json"},signal:AbortSignal.timeout(10000)}),accountsData=await accountsResponse.json();if(!accountsResponse.ok)throw new Error("Zoho Mail account discovery failed.");const accounts=Array.isArray(accountsData.data)?accountsData.data:[];const normalized=fromAddress.toLowerCase(),account=accounts.find(item=>[item.primaryEmailAddress,item.emailAddress,item.accountName].some(value=>String(value||"").toLowerCase()===normalized))||accounts[0];accountId=account?.accountId;if(!accountId)throw new Error("No Zoho Mail account was found for the configured sender.");zohoAccountIdCache=String(accountId)}
  const response=await fetch(`${mailBase}/accounts/${encodeURIComponent(accountId)}/messages`,{method:"POST",headers:{"Authorization":`Zoho-oauthtoken ${token}`,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({fromAddress,toAddress:to,subject,content:html,mailFormat:"html",askReceipt:"no"}),signal:AbortSignal.timeout(15000)});
  if(response.status===401&&retry){zohoTokenCache=null;return sendZohoEmail({to,subject,html},false)}
  if(!response.ok){const details=await response.text();throw new Error(`Zoho Mail send failed (${response.status})${details?`: ${details.slice(0,180)}`:""}`)}
  return true;
}
function configuredSecret(value){return Boolean(value)&&!/^(your_|generate_|change_|<)/i.test(String(value).trim())}
function selectedEmailProvider(){
  const requested=String(process.env.EMAIL_PROVIDER||"").trim().toLowerCase(),zohoReady=["ZOHO_CLIENT_ID","ZOHO_CLIENT_SECRET","ZOHO_REFRESH_TOKEN","ZOHO_FROM_EMAIL"].every(key=>configuredSecret(process.env[key]));
  if(productionRuntime&&zohoReady&&(requested===""||requested==="development"))return "zoho";
  if(["zoho","resend","development"].includes(requested))return requested;
  if(configuredSecret(process.env.RESEND_API_KEY))return "resend";
  return "development";
}
async function sendTransactionalEmail(message){
  const hasResend=configuredSecret(process.env.RESEND_API_KEY),activeProvider=selectedEmailProvider(),deliveryId=publicId("EML"),timestamp=now();
  db.prepare("INSERT INTO email_deliveries (public_id,recipient,subject,kind,provider,status,created_at) VALUES (?,?,?,?,?,'pending',?)").run(deliveryId,message.to,message.subject,message.kind||"transactional",activeProvider,timestamp);
  try{
    let delivered=false;
    if(activeProvider==="zoho")delivered=await sendZohoEmail(message);
    else if(activeProvider==="resend"){if(!hasResend)throw new Error("Resend requires RESEND_API_KEY.");const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.AUTH_FROM_EMAIL||process.env.RESET_FROM_EMAIL||"StockPrime <onboarding@resend.dev>",to:[message.to],subject:message.subject,html:message.html}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error("Email could not be sent.");delivered=true}
    else if(productionRuntime)throw new Error("Email delivery is not configured.");
    db.prepare("UPDATE email_deliveries SET status=?,attempts=1,sent_at=? WHERE public_id=?").run(delivered?"sent":"skipped",delivered?now():null,deliveryId);
    return delivered;
  }catch(error){
    db.prepare("UPDATE email_deliveries SET status='failed',attempts=1,error_message=? WHERE public_id=?").run(String(error.message||error).slice(0,500),deliveryId);
    throw error;
  }
}
function emailDeliveryStatus(){
  const provider=selectedEmailProvider();
  if(provider==="development")return {provider:"development",configured:!productionRuntime,missing:productionRuntime?["EMAIL_PROVIDER"]:[]};
  if(provider==="zoho"){
    const required=["ZOHO_CLIENT_ID","ZOHO_CLIENT_SECRET","ZOHO_REFRESH_TOKEN","ZOHO_FROM_EMAIL",...(productionRuntime?["OTP_SECRET"]:[])];
    const missing=required.filter(key=>!configuredSecret(process.env[key]));
    return {provider:"zoho",configured:missing.length===0,missing};
  }
  if(provider==="resend"){const configured=configuredSecret(process.env.RESEND_API_KEY);return {provider:"resend",configured,missing:configured?[]:["RESEND_API_KEY"]}}
  if(configuredSecret(process.env.RESEND_API_KEY))return {provider:"resend",configured:true,missing:[]};
  return {provider:"development",configured:!productionRuntime,missing:productionRuntime?["EMAIL_PROVIDER"]:[]};
}
function emailEscape(value){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
function moneyEmail(amountCents,currency="USD"){try{return new Intl.NumberFormat("en-US",{style:"currency",currency}).format(Number(amountCents||0)/100)}catch{return `${currency} ${(Number(amountCents||0)/100).toFixed(2)}`}}
function emailTemplate({eyebrow="StockPrime",title,intro="",content="",actionUrl="",actionLabel="",note=""}){
  const button=actionUrl&&actionLabel?`<p style="margin:28px 0"><a href="${emailEscape(actionUrl)}" style="display:inline-block;background:#0b7a3e;color:#fff;text-decoration:none;padding:13px 22px;border-radius:8px;font-weight:700">${emailEscape(actionLabel)}</a></p>`:"";
  return `<!doctype html><html><body style="margin:0;background:#f3f6f4;font-family:Arial,sans-serif;color:#17211b"><div style="display:none;max-height:0;overflow:hidden">${emailEscape(intro||title)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f4;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #dce7df;border-radius:14px;overflow:hidden"><tr><td style="background:#075c32;padding:24px 30px;color:#fff"><div style="font-size:18px;font-weight:800;letter-spacing:.08em">STOCKPRIME</div></td></tr><tr><td style="padding:32px 30px"><div style="color:#0b7a3e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">${emailEscape(eyebrow)}</div><h1 style="font-size:25px;line-height:1.25;margin:9px 0 14px;color:#102117">${emailEscape(title)}</h1>${intro?`<p style="font-size:16px;line-height:1.65;color:#435248">${emailEscape(intro)}</p>`:""}${content}${button}${note?`<p style="margin-top:26px;padding-top:20px;border-top:1px solid #e3ebe6;color:#6a766e;font-size:13px;line-height:1.55">${emailEscape(note)}</p>`:""}</td></tr><tr><td style="background:#f7faf8;padding:18px 30px;color:#748078;font-size:12px">This is an automated security and account message from StockPrime.</td></tr></table></td></tr></table></body></html>`;
}
function publicUrl(req,pathname){const configured=String(process.env.APP_URL||"").trim().replace(/\/$/,"");if(/^https?:\/\//i.test(configured))return `${configured}${pathname.startsWith("/")?pathname:`/${pathname}`}`;const protocol=String(req?.headers?.["x-forwarded-proto"]||"http").split(",")[0].trim(),host=req?.headers?.host;return host?`${protocol}://${host}${pathname.startsWith("/")?pathname:`/${pathname}`}`:pathname}
async function safeTransactionalEmail(message){try{return await sendTransactionalEmail(message)}catch(error){console.error(`Email delivery failed (${message.kind||"transactional"}): ${error.message}`);return false}}
async function sendPasswordReset(email,link){
  const sent=await sendTransactionalEmail({to:email,kind:"login_code_reset",subject:"Reset your StockPrime login code",html:emailTemplate({eyebrow:"Security",title:"Reset your login code",intro:"We received a request to replace the private six-digit login code for your account.",actionUrl:link,actionLabel:"Choose a new login code",note:"This link expires in 30 minutes and works only once. If you did not request this, you can safely ignore this email."})});
  if(!sent)console.log(`[password reset] ${email}: ${link}`);return sent;
}
async function sendVerificationCode(email,code,purpose){
  const action=purpose==="registration"?"confirm your StockPrime account":"complete your StockPrime sign in";
  const title=purpose==="registration"?"Confirm your account":"Confirm your sign in",content=`<p style="font-size:16px;line-height:1.65;color:#435248">Use this one-time code to ${action}:</p><div style="margin:24px 0;padding:18px;text-align:center;background:#eef8f2;border:1px solid #cce8d7;border-radius:10px;font-size:34px;font-weight:800;letter-spacing:9px;color:#075c32">${code}</div>`;
  const sent=await sendTransactionalEmail({to:email,kind:`${purpose}_code`,subject:purpose==="registration"?"Confirm your StockPrime account":"Your StockPrime sign-in code",html:emailTemplate({eyebrow:"Verification",title,content,note:`This code expires in ${verificationCodeMinutes} minutes and can only be used once. Never share it with anyone.`})});
  if(!sent)console.log(`[${purpose} verification] ${email}: ${code}`);return sent;
}
async function sendWelcomeEmail(user,req){return safeTransactionalEmail({to:user.email,kind:"welcome",subject:"Welcome to StockPrime",html:emailTemplate({eyebrow:"Account ready",title:`Welcome, ${user.first_name||user.name||"Investor"}`,intro:"Your email address is confirmed and your StockPrime account is ready.",actionUrl:publicUrl(req,"/dashboard.html"),actionLabel:"Open your dashboard",note:"If you did not create this account, contact support immediately."})})}
async function sendAccountNotificationEmail(user,{title,message,category="general"}){return safeTransactionalEmail({to:user.email,kind:`notification_${category}`,subject:title,html:emailTemplate({eyebrow:`${category} notification`,title,intro:message,note:"You can also view this notification in your StockPrime dashboard."})})}
async function sendNotificationBatch(users,notification){const results=[];for(let index=0;index<users.length;index+=5){const batch=users.slice(index,index+5);results.push(...await Promise.all(batch.map(user=>sendAccountNotificationEmail(user,notification))))}return {sent:results.filter(Boolean).length,failed:results.filter(result=>!result).length}}
async function sendWalletEventEmail(user,{type,status,amountCents,feeCents=0,currency="USD",method="",transactionId=""}){
  const isWithdrawal=type==="withdrawal",label=isWithdrawal?"Withdrawal":"Deposit",statusLabel=String(status).replace(/^./,char=>char.toUpperCase()),rows=[["Amount",moneyEmail(amountCents,currency)],["Status",statusLabel],["Method",method],["Reference",transactionId]];if(isWithdrawal&&feeCents)rows.splice(1,0,["Fee",moneyEmail(feeCents,currency)]);
  const content=`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border-collapse:collapse">${rows.filter(row=>row[1]).map(([name,value])=>`<tr><td style="padding:10px;border-bottom:1px solid #e3ebe6;color:#6a766e">${emailEscape(name)}</td><td style="padding:10px;border-bottom:1px solid #e3ebe6;text-align:right;font-weight:700">${emailEscape(value)}</td></tr>`).join("")}</table>`;
  const title=status==="pending"?`${label} request received`:`${label} ${status}`;
  const intro=isWithdrawal&&status==="pending"?"A withdrawal has just been requested from your StockPrime account. If this was not you, contact support immediately.":`Your ${label.toLowerCase()} status has been updated.`;
  return safeTransactionalEmail({to:user.email,kind:`${type}_${status}`,subject:`StockPrime ${label.toLowerCase()} ${status}`,html:emailTemplate({eyebrow:"Wallet activity",title,intro,content,note:"For your security, StockPrime will never ask for your login code by email."})});
}
async function marketNews(){
  const cached=newsCache.get("market");if(cached&&Date.now()-cached.cachedAt<10*60000)return cached.value;
  const symbols=[...supportedStockSymbols].join(",");
  if(process.env.ALPHA_VANTAGE_API_KEY){
    const url=`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(symbols)}&sort=LATEST&limit=9&apikey=${encodeURIComponent(process.env.ALPHA_VANTAGE_API_KEY)}`;
    const response=await fetch(url,{headers:{"User-Agent":"StockPrime/1.0"},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Object.assign(new Error(`News provider returned ${response.status}.`),{status:502});
    const data=await response.json(),feed=Array.isArray(data.feed)?data.feed:[];
    const value={source:"Alpha Vantage",updatedAt:now(),items:feed.slice(0,9).map(item=>{
      const ticker=item.ticker_sentiment?.[0]?.ticker||"MARKET",score=Number(item.overall_sentiment_score||0);
      return {symbol:ticker,source:item.source||"Market News",headline:item.title,summary:item.summary||"",url:item.url,publishedAt:item.time_published?new Date(`${item.time_published.slice(0,4)}-${item.time_published.slice(4,6)}-${item.time_published.slice(6,8)}T${item.time_published.slice(9,11)}:${item.time_published.slice(11,13)}:${item.time_published.slice(13,15)}Z`).toISOString():now(),sentiment:item.overall_sentiment_label||"Neutral",sentimentScore:score,bannerImage:item.banner_image||""};
    }).filter(item=>item.headline&&item.url)};
    newsCache.set("market",{value,cachedAt:Date.now()});return value;
  }
  if(process.env.FINNHUB_API_KEY){
    const response=await fetch(`https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(process.env.FINNHUB_API_KEY)}`,{headers:{"User-Agent":"StockPrime/1.0"},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Object.assign(new Error(`News provider returned ${response.status}.`),{status:502});
    const data=await response.json();
    const value={source:"Finnhub",updatedAt:now(),items:(Array.isArray(data)?data:[]).slice(0,9).map(item=>({symbol:item.related?.split(",")?.find(symbol=>supportedStockSymbols.has(symbol))||"MARKET",source:item.source||"Market News",headline:item.headline,summary:item.summary||"",url:item.url,publishedAt:item.datetime?new Date(item.datetime*1000).toISOString():now(),sentiment:"Latest",sentimentScore:0,bannerImage:item.image||""})).filter(item=>item.headline&&item.url)};
    newsCache.set("market",{value,cachedAt:Date.now()});return value;
  }
  throw Object.assign(new Error("Market news feed is not configured."),{status:503,code:"MARKET_NEWS_NOT_CONFIGURED"});
}
function createSession(user, req) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + sessionDays*86400000).toISOString();
  db.prepare("INSERT INTO sessions (user_id,token_hash,ip_address,user_agent,expires_at,created_at) VALUES (?,?,?,?,?,?)")
    .run(user.id, sha256(token), requestIp(req), String(req.headers["user-agent"]||"").slice(0,500), expires, now());
  return token;
}
function userPayload(user) {
  const kyc=db.prepare("SELECT status,submitted_at,reviewed_at,review_note FROM kyc_submissions WHERE user_id=?").get(user.id);
  return { id:user.public_id, name:user.name, email:user.email, phone:user.phone||"", country:user.country, currency:user.currency, referralCode:user.referral_code, createdAt:user.created_at, emailVerified:Boolean(user.email_verified_at), kycStatus:kyc?.status||"not_submitted", kycSubmittedAt:kyc?.submitted_at||null, kycReviewedAt:kyc?.reviewed_at||null, kycReviewNote:kyc?.review_note||"" };
}
function kycResponse(row){
  if(!row)return null;
  return {id:row.public_id,status:row.status,firstName:row.first_name,lastName:row.last_name,dateOfBirth:row.date_of_birth,nationality:row.nationality,documentType:row.document_type,documentLast4:String(row.document_number||"").slice(-4),documentFrontName:row.document_front_name||"",selfieName:row.selfie_name||"",address:row.address,city:row.city,country:row.country,submittedAt:row.submitted_at,reviewedAt:row.reviewed_at,reviewNote:row.review_note||""};
}
function maskedEmail(email){const [name,domain]=String(email).split("@");return `${name.slice(0,2)}${"*".repeat(Math.max(1,name.length-2))}@${domain}`}
async function issueVerificationCode(user,purpose,req,{force=false}={}){
  if(productionRuntime&&!emailDeliveryStatus().configured)throw Object.assign(new Error("Email verification security is not configured."),{status:503});
  const latest=db.prepare("SELECT created_at FROM email_verification_codes WHERE user_id=? AND purpose=? ORDER BY id DESC LIMIT 1").get(user.id,purpose);
  if(!force&&latest&&Date.now()-new Date(latest.created_at).getTime()<30000)throw Object.assign(new Error("Please wait 30 seconds before requesting another code."),{status:429});
  const code=String(crypto.randomInt(0,1000000)).padStart(6,"0"),timestamp=now(),expires=new Date(Date.now()+verificationCodeMinutes*60000).toISOString();
  db.prepare("UPDATE email_verification_codes SET used_at=? WHERE user_id=? AND purpose=? AND used_at IS NULL").run(timestamp,user.id,purpose);
  db.prepare("INSERT INTO email_verification_codes (user_id,purpose,code_hash,expires_at,requested_ip,created_at) VALUES (?,?,?,?,?,?)").run(user.id,purpose,verificationCodeHash(code),expires,requestIp(req),timestamp);
  try{await sendVerificationCode(user.email,code,purpose)}catch(error){console.error(error.message);throw Object.assign(new Error("We could not send the verification email. Please try again."),{status:502})}
  const hasEmailProvider=emailDeliveryStatus().configured&&emailDeliveryStatus().provider!=="development";
  return {developmentCode:!hasEmailProvider&&!productionRuntime?code:undefined,expiresInSeconds:verificationCodeMinutes*60};
}
function verifyEmailCode(user,purpose,code){
  const record=db.prepare("SELECT * FROM email_verification_codes WHERE user_id=? AND purpose=? AND used_at IS NULL ORDER BY id DESC LIMIT 1").get(user.id,purpose);
  if(!record||record.expires_at<=now())throw Object.assign(new Error("This verification code has expired. Request a new code."),{status:422});
  if(record.attempts>=5)throw Object.assign(new Error("Too many incorrect attempts. Request a new code."),{status:429});
  if(!/^\d{6}$/.test(code)||record.code_hash!==verificationCodeHash(code)){db.prepare("UPDATE email_verification_codes SET attempts=attempts+1 WHERE id=?").run(record.id);throw Object.assign(new Error("The verification code is incorrect."),{status:422})}
  db.prepare("UPDATE email_verification_codes SET used_at=? WHERE id=?").run(now(),record.id);
}
function audit(actorId, action, entityType, entityId, details, req) {
  db.prepare("INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES ('user',?,?,?,?,?,?,?)")
    .run(actorId, action, entityType, entityId, JSON.stringify(details||{}), requestIp(req), now());
}

async function api(req, res, url) {
  if(req.method==="GET"&&url.pathname==="/api/health"){const email=emailDeliveryStatus(),ready=!productionRuntime||email.configured;return json(res,ready?200:503,{status:ready?"ok":"configuration_required",service:"stockprime",time:now(),email:{provider:email.provider,configured:email.configured,missing:email.missing}})}
  if(req.method==="GET"&&url.pathname==="/api/btc-price"){
    if(btcPriceCache.value&&Date.now()-btcPriceCache.cachedAt<30000)return json(res,200,btcPriceCache.value);
    try{
      const response=await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot",{headers:{"Accept":"application/json","User-Agent":"StockPrime/1.0"},signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error(`Price provider returned ${response.status}.`);
      const payload=await response.json(),amount=Number(payload?.data?.amount);
      if(!Number.isFinite(amount)||amount<=0)throw new Error("The BTC-USD price is unavailable.");
      btcPriceCache.value={amount,currency:"USD",source:"Coinbase",updatedAt:now()};btcPriceCache.cachedAt=Date.now();
      return json(res,200,btcPriceCache.value);
    }catch(error){console.warn(`[btc price] ${error.message}`);if(!productionRuntime)return json(res,503,{error:"The live BTC price is temporarily unavailable.",available:false});throw Object.assign(new Error("The live BTC price is temporarily unavailable."),{status:502})}
  }
  if (req.method !== "GET" && !sameOrigin(req)) return json(res, 403, { error:"Invalid request origin." });

  if(req.method==="POST"&&url.pathname==="/api/support/conversations"){
    const input=await body(req),message=String(input.message||"").trim(),name=String(input.name||"").trim().slice(0,80),email=String(input.email||"").trim().toLowerCase().slice(0,160),user=currentUser(req);
    if(message.length<2||message.length>500)return json(res,422,{error:"Enter a message between 2 and 500 characters."});
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(res,422,{error:"Enter a valid email address."});
    const id=publicId("SUP"),token=crypto.randomBytes(32).toString("base64url"),timestamp=now(),senderName=user?.name||name||"Website visitor";
    db.exec("BEGIN IMMEDIATE");
    try{
      const conversation=db.prepare("INSERT INTO support_conversations (public_id,visitor_token_hash,user_id,visitor_name,visitor_email,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id,sha256(token),user?.id||null,user?.name||name||null,user?.email||email||null,timestamp,timestamp);
      db.prepare("INSERT INTO support_messages (public_id,conversation_id,sender_type,sender_name,message,created_at) VALUES (?,?,'visitor',?,?,?)").run(publicId("MSG"),conversation.lastInsertRowid,senderName,message,timestamp);
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error}
    return json(res,201,{conversation:{id,token,status:"open"},messages:[{senderType:"visitor",senderName,message,createdAt:timestamp}]});
  }
  if(/^\/api\/support\/conversations\/[^/]+\/messages$/.test(url.pathname)){
    const conversationId=decodeURIComponent(url.pathname.split("/")[4]),token=String(req.headers["x-support-token"]||""),conversation=token&&db.prepare("SELECT * FROM support_conversations WHERE public_id=? AND visitor_token_hash=?").get(conversationId,sha256(token));
    if(!conversation)return json(res,404,{error:"Support conversation was not found."});
    if(req.method==="GET"){
      const messages=db.prepare("SELECT public_id AS id,sender_type AS senderType,sender_name AS senderName,message,created_at AS createdAt FROM support_messages WHERE conversation_id=? ORDER BY support_messages.id").all(conversation.id);
      return json(res,200,{conversation:{id:conversation.public_id,status:conversation.status},messages});
    }
    if(req.method==="POST"){
      if(conversation.status!=="open")return json(res,409,{error:"This support conversation is closed."});
      const input=await body(req),message=String(input.message||"").trim();
      if(message.length<2||message.length>500)return json(res,422,{error:"Enter a message between 2 and 500 characters."});
      const recent=db.prepare("SELECT COUNT(*) count FROM support_messages WHERE conversation_id=? AND sender_type='visitor' AND created_at>?").get(conversation.id,new Date(Date.now()-60000).toISOString()).count;
      if(recent>=8)return json(res,429,{error:"Please wait before sending another message."});
      const timestamp=now(),senderName=conversation.visitor_name||"Website visitor";db.prepare("INSERT INTO support_messages (public_id,conversation_id,sender_type,sender_name,message,created_at) VALUES (?,?,'visitor',?,?,?)").run(publicId("MSG"),conversation.id,senderName,message,timestamp);db.prepare("UPDATE support_conversations SET updated_at=? WHERE id=?").run(timestamp,conversation.id);
      return json(res,201,{message:{senderType:"visitor",senderName,message,createdAt:timestamp}});
    }
  }

  if(req.method==="GET"&&url.pathname==="/api/referrals/validate"){
    const code=String(url.searchParams.get("code")||"").trim().toUpperCase();
    if(!settingEnabled("referrals_enabled"))return json(res,503,{valid:false,error:"Referrals are currently unavailable."});
    const owner=code&&db.prepare("SELECT name,referral_code FROM users WHERE referral_code=? AND status='active'").get(code);
    return owner?json(res,200,{valid:true,code:owner.referral_code,message:"Referral code applied successfully."}):json(res,404,{valid:false,error:"Invalid referral code."});
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const input = await body(req);
    const firstName=String(input.firstName||"").trim(),lastName=String(input.lastName||"").trim(),name=String(input.name||`${firstName} ${lastName}`).trim(),phone=String(input.phone||"").trim(),email = String(input.email||"").trim().toLowerCase(),loginCode=String(input.loginCode||"").trim(),loginCodeConfirmation=String(input.loginCodeConfirmation||"").trim(),country = String(input.country||"").trim(), currency = String(input.currency||"USD").trim().toUpperCase(),requestedReferral=String(input.referralCode||"").trim().toUpperCase();
    const errors = {};
    if(firstName.length<1||firstName.length>50)errors.firstName="Enter your first name.";
    if(lastName.length<1||lastName.length>50)errors.lastName="Enter your last name.";
    if(!/^\+?[0-9 ()-]{7,25}$/.test(phone))errors.phone="Enter a valid phone number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
    if(!/^\d{6}$/.test(loginCode))errors.loginCode="Create a 6-digit login code.";
    if(loginCode!==loginCodeConfirmation)errors.loginCodeConfirmation="Login codes do not match.";
    if (!country) errors.country = "Select your country.";
    if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "Select a valid currency.";
    const referrer=requestedReferral&&settingEnabled("referrals_enabled")?db.prepare("SELECT id,public_id,email,phone FROM users WHERE referral_code=? AND status='active'").get(requestedReferral):null;
    if(requestedReferral&&!referrer)errors.referralCode="Invalid referral code.";
    if(referrer&&(referrer.email===email||(referrer.phone&&referrer.phone.replace(/\D/g,"")===phone.replace(/\D/g,""))))errors.referralCode="You cannot use your own referral code.";
    if (Object.keys(errors).length) return json(res, 422, { error:"Please correct the highlighted fields.", fields:errors });
    if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) return json(res, 409, { error:"An account already exists for this email.", fields:{email:"Email is already registered."} });
    const timestamp=now(), passwordHashValue=await passwordHash(crypto.randomBytes(32).toString("hex")),loginCodeHash=await passwordHash(loginCode),id=publicId("USR"),code=referralCode(),ip=requestIp(req);
    db.exec("BEGIN IMMEDIATE");
    let result;
    try {
      result=db.prepare("INSERT INTO users (public_id,name,email,password_hash,login_code_hash,country,currency,first_name,last_name,phone,referral_code,registration_ip,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,name,email,passwordHashValue,loginCodeHash,country,currency,firstName,lastName,phone,code,ip,null,timestamp,timestamp);
      db.prepare("INSERT INTO wallets (user_id,currency,available_cents,created_at,updated_at) VALUES (?,?,0,?,?)").run(result.lastInsertRowid,currency,timestamp,timestamp);
      db.prepare("INSERT INTO affiliates (user_id,affiliate_id,status,created_at,updated_at) VALUES (?,?,'inactive',?,?)").run(result.lastInsertRowid,publicId("AFF"),timestamp,timestamp);
      if(referrer)db.prepare("INSERT INTO referrals (public_id,referrer_user_id,referred_user_id,referral_code,created_at) VALUES (?,?,?,?,?)").run(publicId("RFL"),referrer.id,result.lastInsertRowid,requestedReferral,timestamp);
      if(db.prepare("SELECT COUNT(*) count FROM users WHERE id<>? AND ((registration_ip<>'' AND registration_ip=?) OR (phone<>'' AND phone=?))").get(result.lastInsertRowid,ip,phone).count>0)db.prepare("INSERT INTO fraud_flags (user_id,reason,details_json,created_at) VALUES (?,'duplicate_registration_signal',?,?)").run(result.lastInsertRowid,JSON.stringify({registrationIp:ip,phone}),timestamp);
      db.prepare("INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES ('user',?,'registered','user',?,?,?,?)").run(id,id,JSON.stringify({referralCode:requestedReferral||null}),ip,timestamp);
      db.exec("COMMIT");
    } catch(error) { db.exec("ROLLBACK"); throw error; }
    const user=db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
    let verification;
    try{verification=await issueVerificationCode(user,"registration",req,{force:true})}catch(error){db.prepare("DELETE FROM users WHERE id=?").run(user.id);throw error}
    return json(res,201,{message:"Account created. Confirm the code sent to your email.",verificationRequired:true,purpose:"registration",email:user.email,maskedEmail:maskedEmail(user.email),...verification},{"Set-Cookie":clearCookie()});
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const ip=requestIp(req), attempts=loginAttempts.get(ip)||{count:0,reset:Date.now()+15*60000};
    if(Date.now()>attempts.reset){attempts.count=0;attempts.reset=Date.now()+15*60000}
    if(attempts.count>=10)return json(res,429,{error:"Too many login attempts. Try again later."});
    const input=await body(req),email=String(input.email||"").trim().toLowerCase(),loginCode=String(input.loginCode||""),user=db.prepare("SELECT * FROM users WHERE email=?").get(email);
    const validLogin=user&&(user.login_code_hash?(/^\d{6}$/.test(loginCode)&&await passwordMatches(loginCode,user.login_code_hash)):await passwordMatches(loginCode,user.password_hash));
    if(!validLogin){attempts.count++;loginAttempts.set(ip,attempts);return json(res,401,{error:"Incorrect email address or login code."})}
    if(user.status!=="active")return json(res,403,{error:"This account is not active."});
    loginAttempts.delete(ip);
    const purpose=user.email_verified_at?"login":"registration",verification=await issueVerificationCode(user,purpose,req,{force:true});
    audit(user.public_id,purpose==="login"?"requested_sign_in_code":"requested_registration_code","email_verification",null,{},req);
    return json(res,200,{message:purpose==="login"?"Confirm the code sent to your email.":"Confirm your email to finish setting up your account.",verificationRequired:true,purpose,email:user.email,maskedEmail:maskedEmail(user.email),...verification},{"Set-Cookie":clearCookie()});
  }
  if(req.method==="POST"&&url.pathname==="/api/auth/verify-registration"){
    const input=await body(req),email=String(input.email||"").trim().toLowerCase(),code=String(input.code||"").trim(),user=db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if(!user)return json(res,422,{error:"This confirmation request is invalid."});
    verifyEmailCode(user,"registration",code);
    const timestamp=now();db.prepare("UPDATE users SET email_verified_at=COALESCE(email_verified_at,?),updated_at=? WHERE id=?").run(timestamp,timestamp,user.id);
    const verified=db.prepare("SELECT * FROM users WHERE id=?").get(user.id),token=createSession(verified,req);audit(verified.public_id,"confirmed_email","user",verified.public_id,{},req);const welcomeEmailSent=await sendWelcomeEmail(verified,req);
    return json(res,200,{message:"Email confirmed. Your account is ready.",user:userPayload(verified),welcomeEmailSent},{"Set-Cookie":sessionCookie(token)});
  }
  if(req.method==="POST"&&url.pathname==="/api/auth/verify-login"){
    const input=await body(req),email=String(input.email||"").trim().toLowerCase(),code=String(input.code||"").trim(),user=db.prepare("SELECT * FROM users WHERE email=? AND status='active'").get(email);
    if(!user||!user.email_verified_at)return json(res,422,{error:"This sign-in confirmation request is invalid."});
    verifyEmailCode(user,"login",code);
    const token=createSession(user,req);audit(user.public_id,"verified_login_code","session",null,{},req);
    return json(res,200,{message:"Code confirmed. You are signed in.",user:userPayload(user)},{"Set-Cookie":sessionCookie(token)});
  }
  if(req.method==="POST"&&url.pathname==="/api/auth/resend-code"){
    const input=await body(req),email=String(input.email||"").trim().toLowerCase(),requestedPurpose=String(input.purpose||""),user=db.prepare("SELECT * FROM users WHERE email=? AND status='active'").get(email);
    if(!user)return json(res,200,{message:"If the account exists, a new code has been sent."});
    const purpose=user.email_verified_at?"login":"registration";
    if(requestedPurpose&&requestedPurpose!==purpose)return json(res,409,{error:"The verification step has changed. Return to sign in and try again."});
    const verification=await issueVerificationCode(user,purpose,req);
    return json(res,200,{message:"A new verification code has been sent.",purpose,email:user.email,maskedEmail:maskedEmail(user.email),...verification});
  }
  if(req.method==="POST"&&url.pathname==="/api/password/forgot"){
    const input=await body(req),email=String(input.email||"").trim().toLowerCase(),user=db.prepare("SELECT id,email FROM users WHERE email=? AND status='active'").get(email);
    if(user){const token=crypto.randomBytes(32).toString("base64url"),timestamp=now(),expires=new Date(Date.now()+30*60000).toISOString();db.prepare("UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL").run(timestamp,user.id);db.prepare("INSERT INTO password_reset_tokens (user_id,token_hash,expires_at,requested_ip,created_at) VALUES (?,?,?,?,?)").run(user.id,sha256(token),expires,requestIp(req),timestamp);const link=publicUrl(req,`/reset-password.html?token=${encodeURIComponent(token)}`);try{await sendPasswordReset(user.email,link)}catch(error){console.error(error.message)}}
    return json(res,200,{message:"If an account exists for that email, a login-code reset link has been sent."});
  }
  if(req.method==="POST"&&url.pathname==="/api/password/reset"){
    const input=await body(req),token=String(input.token||""),loginCode=String(input.loginCode||input.password||""),confirmation=String(input.loginCodeConfirmation||input.passwordConfirmation||"");
    if(!/^\d{6}$/.test(loginCode))return json(res,422,{error:"Choose a six-digit login code."});if(loginCode!==confirmation)return json(res,422,{error:"Login codes do not match."});
    const record=db.prepare("SELECT * FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?").get(sha256(token),now());if(!record)return json(res,422,{error:"This login-code reset link is invalid or has expired."});
    const timestamp=now(),hash=await passwordHash(loginCode);db.exec("BEGIN IMMEDIATE");try{db.prepare("UPDATE users SET login_code_hash=?,updated_at=? WHERE id=?").run(hash,timestamp,record.user_id);db.prepare("UPDATE password_reset_tokens SET used_at=? WHERE id=?").run(timestamp,record.id);db.prepare("DELETE FROM sessions WHERE user_id=?").run(record.user_id);db.exec("COMMIT")}catch(error){db.exec("ROLLBACK");throw error}
    const updatedUser=db.prepare("SELECT email,name FROM users WHERE id=?").get(record.user_id);await safeTransactionalEmail({to:updatedUser.email,kind:"login_code_changed",subject:"Your StockPrime login code was changed",html:emailTemplate({eyebrow:"Security alert",title:"Login code changed",intro:"Your private six-digit StockPrime login code was changed successfully.",note:"All existing sessions were signed out. If you did not make this change, contact support immediately."})});
    return json(res,200,{message:"Login code updated. You can now sign in."});
  }
  if(req.method==="POST"&&url.pathname==="/api/password/change"){
    const user=requireUser(req,res);if(!user)return;const input=await body(req),current=String(input.currentLoginCode||input.currentPassword||""),loginCode=String(input.newLoginCode||input.newPassword||""),confirmation=String(input.loginCodeConfirmation||input.passwordConfirmation||""),record=db.prepare("SELECT login_code_hash FROM users WHERE id=?").get(user.id);
    if(!/^\d{6}$/.test(current)||!(await passwordMatches(current,record.login_code_hash)))return json(res,422,{error:"Current login code is incorrect."});if(!/^\d{6}$/.test(loginCode))return json(res,422,{error:"Choose a six-digit login code."});if(loginCode!==confirmation)return json(res,422,{error:"Login codes do not match."});
    db.prepare("UPDATE users SET login_code_hash=?,updated_at=? WHERE id=?").run(await passwordHash(loginCode),now(),user.id);db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(user.id,sha256(cookies(req).stockprime_session));const emailSent=await safeTransactionalEmail({to:user.email,kind:"login_code_changed",subject:"Your StockPrime login code was changed",html:emailTemplate({eyebrow:"Security alert",title:"Login code changed",intro:"Your private six-digit StockPrime login code was changed successfully.",note:"Other signed-in sessions were closed. If you did not make this change, contact support immediately."})});return json(res,200,{message:"Login code changed successfully.",emailSent});
  }
  if(req.method==="POST"&&url.pathname==="/api/admin/login"){
    const input=await body(req),email=String(input.email||"").trim().toLowerCase(),password=String(input.password||""),expectedEmail=String(process.env.ADMIN_EMAIL||"admin@stockprimeglobal.test").toLowerCase(),expectedPassword=process.env.ADMIN_PASSWORD||"Admin123!";
    if(email!==expectedEmail||password!==expectedPassword)return json(res,401,{error:"Incorrect administrator email or password."});const token=crypto.randomBytes(32).toString("base64url");adminSessions.set(sha256(token),{email,name:"Super Admin",expiresAt:Date.now()+8*3600000});return json(res,200,{message:"Administrator signed in.",admin:{email,name:"Super Admin",role:"Super Admin"}},{"Set-Cookie":adminCookie(token)});
  }
  if(req.method==="POST"&&url.pathname==="/api/admin/logout"){const token=cookies(req).stockprime_admin_session;if(token)adminSessions.delete(sha256(token));return json(res,200,{message:"Signed out."},{"Set-Cookie":clearAdminCookie()})}
  if(req.method==="GET"&&url.pathname==="/api/admin/support/conversations"){
    if(!requireAdmin(req,res))return;const conversations=db.prepare(`SELECT c.public_id AS id,c.visitor_name AS visitorName,c.visitor_email AS visitorEmail,c.status,c.created_at AS createdAt,c.updated_at AS updatedAt,COUNT(m.id) AS messageCount,(SELECT message FROM support_messages latest WHERE latest.conversation_id=c.id ORDER BY latest.id DESC LIMIT 1) AS lastMessage,(SELECT sender_type FROM support_messages latest WHERE latest.conversation_id=c.id ORDER BY latest.id DESC LIMIT 1) AS lastSenderType FROM support_conversations c LEFT JOIN support_messages m ON m.conversation_id=c.id GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 200`).all();return json(res,200,{conversations});
  }
  if(req.method==="GET"&&/^\/api\/admin\/support\/conversations\/[^/]+\/messages$/.test(url.pathname)){
    if(!requireAdmin(req,res))return;const conversationId=decodeURIComponent(url.pathname.split("/")[5]),conversation=db.prepare("SELECT id,public_id AS publicId,visitor_name AS visitorName,visitor_email AS visitorEmail,status,created_at AS createdAt,updated_at AS updatedAt FROM support_conversations WHERE public_id=?").get(conversationId);if(!conversation)return json(res,404,{error:"Support conversation was not found."});const messages=db.prepare("SELECT public_id AS id,sender_type AS senderType,sender_name AS senderName,message,created_at AS createdAt FROM support_messages WHERE conversation_id=? ORDER BY support_messages.id").all(conversation.id);delete conversation.id;return json(res,200,{conversation,messages});
  }
  if(req.method==="POST"&&/^\/api\/admin\/support\/conversations\/[^/]+\/messages$/.test(url.pathname)){
    const admin=requireAdmin(req,res);if(!admin)return;const conversationId=decodeURIComponent(url.pathname.split("/")[5]),conversation=db.prepare("SELECT id,status FROM support_conversations WHERE public_id=?").get(conversationId);if(!conversation)return json(res,404,{error:"Support conversation was not found."});const input=await body(req),message=String(input.message||"").trim();if(message.length<2||message.length>1000)return json(res,422,{error:"Enter a reply between 2 and 1,000 characters."});const timestamp=now();db.prepare("INSERT INTO support_messages (public_id,conversation_id,sender_type,sender_name,message,created_at) VALUES (?,?,'admin',?,?,?)").run(publicId("MSG"),conversation.id,admin.name||"StockPrime Support",message,timestamp);db.prepare("UPDATE support_conversations SET status='open',updated_at=? WHERE id=?").run(timestamp,conversation.id);return json(res,201,{message:"Reply sent to the visitor."});
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/referral-settings"){
    if(!requireAdmin(req,res))return;const settings=Object.fromEntries(db.prepare("SELECT key,value FROM platform_settings").all().map(row=>[row.key,row.value]));return json(res,200,{settings});
  }
  if(req.method==="POST"&&url.pathname==="/api/admin/referral-settings"){
    const admin=requireAdmin(req,res);if(!admin)return;const input=await body(req),values={welcome_bonus_cents:0,affiliate_membership_fee_cents:Math.round(Number(input.membershipFee)*100),referral_commission_bps:Math.round(Number(input.commissionRate)*100),referral_qualifying_investment_cents:Math.round(Number(input.qualifyingInvestment)*100),referrals_enabled:input.referralsEnabled?"1":"0",affiliate_program_enabled:input.affiliateEnabled?"1":"0"};
    if(!Number.isSafeInteger(values.welcome_bonus_cents)||values.welcome_bonus_cents<0)return json(res,422,{error:"Enter a valid welcome bonus."});if(!Number.isSafeInteger(values.affiliate_membership_fee_cents)||values.affiliate_membership_fee_cents<0)return json(res,422,{error:"Enter a valid membership fee."});if(!Number.isSafeInteger(values.referral_commission_bps)||values.referral_commission_bps<0||values.referral_commission_bps>10000)return json(res,422,{error:"Commission must be between 0% and 100%."});if(!Number.isSafeInteger(values.referral_qualifying_investment_cents)||values.referral_qualifying_investment_cents<0)return json(res,422,{error:"Enter a valid qualifying investment."});
    const timestamp=now(),save=db.prepare("INSERT INTO platform_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");db.exec("BEGIN IMMEDIATE");try{for(const [key,value] of Object.entries(values))save.run(key,String(value),timestamp);db.exec("COMMIT")}catch(error){db.exec("ROLLBACK");throw error}db.prepare("INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES ('admin',?,'updated_referral_settings','platform_settings','referrals',?,?,?)").run(admin.email,JSON.stringify(values),requestIp(req),timestamp);return json(res,200,{message:"Referral and affiliate settings updated."});
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/referrals"){
    if(!requireAdmin(req,res))return;const referrals=db.prepare(`SELECT r.public_id AS id,r.referral_code,r.status,r.investment_status,r.qualifying_investment_cents,r.commission_cents,r.created_at,r.qualified_at,referrer.name AS referrer_name,referrer.email AS referrer_email,referred.name AS referred_name,referred.email AS referred_email FROM referrals r JOIN users referrer ON referrer.id=r.referrer_user_id JOIN users referred ON referred.id=r.referred_user_id ORDER BY r.created_at DESC`).all();return json(res,200,{referrals});
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/affiliate-withdrawals"){
    if(!requireAdmin(req,res))return;const withdrawals=db.prepare("SELECT w.public_id AS id,w.amount_cents,w.method,w.destination,w.status,w.admin_note,w.created_at,w.updated_at,u.name,u.email FROM affiliate_withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.created_at DESC").all();return json(res,200,{withdrawals});
  }
  if(req.method==="POST"&&/^\/api\/admin\/affiliate-withdrawals\/[^/]+\/status$/.test(url.pathname)){
    const admin=requireAdmin(req,res);if(!admin)return;const input=await body(req),status=String(input.status||"").toLowerCase(),note=String(input.note||"").trim(),id=decodeURIComponent(url.pathname.split("/")[4]);if(!["approved","rejected","paid"].includes(status))return json(res,422,{error:"Choose a valid withdrawal status."});const withdrawal=db.prepare("SELECT w.*,u.email,u.name FROM affiliate_withdrawals w JOIN users u ON u.id=w.user_id WHERE w.public_id=?").get(id);if(!withdrawal)return json(res,404,{error:"Pending withdrawal was not found."});const result=db.prepare("UPDATE affiliate_withdrawals SET status=?,admin_note=?,updated_at=? WHERE public_id=? AND status IN ('pending','approved')").run(status,note,now(),id);if(!result.changes)return json(res,409,{error:"This withdrawal can no longer be updated."});const emailSent=await sendWalletEventEmail(withdrawal,{type:"withdrawal",status,amountCents:withdrawal.amount_cents,currency:"USD",method:withdrawal.method,transactionId:id});return json(res,200,{message:`Affiliate withdrawal ${status}.`,emailSent});
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/users"){
    if(!requireAdmin(req,res))return;const users=db.prepare("SELECT u.public_id AS id,u.name,u.email,u.status,u.created_at AS joined,u.email_verified_at,k.status AS kyc_status FROM users u LEFT JOIN kyc_submissions k ON k.user_id=u.id ORDER BY u.created_at DESC").all();return json(res,200,{users:users.map(user=>({...user,status:user.status[0].toUpperCase()+user.status.slice(1),emailVerified:Boolean(user.email_verified_at),kyc:user.kyc_status||"not_submitted",email_verified_at:undefined,kyc_status:undefined}))});
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/kyc"){
    if(!requireAdmin(req,res))return;const submissions=db.prepare("SELECT k.*,u.public_id AS user_public_id,u.name AS user_name,u.email AS user_email FROM kyc_submissions k JOIN users u ON u.id=k.user_id ORDER BY CASE k.status WHEN 'pending' THEN 0 ELSE 1 END,k.submitted_at DESC").all();return json(res,200,{submissions:submissions.map(row=>({...kycResponse(row),userId:row.user_public_id,userName:row.user_name,userEmail:row.user_email}))});
  }
  if(req.method==="POST"&&/^\/api\/admin\/kyc\/[^/]+\/status$/.test(url.pathname)){
    const admin=requireAdmin(req,res);if(!admin)return;const id=decodeURIComponent(url.pathname.split("/")[4]),input=await body(req),status=String(input.status||"").toLowerCase(),reviewNote=String(input.reviewNote||"").trim().slice(0,1000);if(!["approved","rejected","resubmission_required"].includes(status))return json(res,422,{error:"Choose a valid KYC review status."});const submission=db.prepare("SELECT k.*,u.email,u.name,u.public_id AS user_public_id FROM kyc_submissions k JOIN users u ON u.id=k.user_id WHERE k.public_id=?").get(id);if(!submission)return json(res,404,{error:"KYC submission was not found."});const timestamp=now();db.prepare("UPDATE kyc_submissions SET status=?,review_note=?,reviewed_at=?,updated_at=? WHERE public_id=?").run(status,reviewNote||null,timestamp,timestamp,id);db.prepare("INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES ('admin',?,'reviewed_kyc','kyc_submission',?,?,?,?)").run(admin.email,id,JSON.stringify({status,reviewNote}),requestIp(req),timestamp);const label=status==="approved"?"approved":status==="rejected"?"not approved":"returned for resubmission",emailSent=await safeTransactionalEmail({to:submission.email,kind:`kyc_${status}`,subject:`Your StockPrime Global KYC application was ${label}`,html:emailTemplate({eyebrow:"Identity verification",title:`KYC application ${label}`,intro:status==="approved"?"Your identity verification has been approved.":"Your identity verification status has changed. Open your dashboard to review the details.",actionUrl:publicUrl(req,"/kyc.html"),actionLabel:"View KYC status",note:reviewNote||"Contact StockPrime Global support if you need help."})});return json(res,200,{message:`KYC application ${label}.`,status,emailSent});
  }
  if(req.method==="POST"&&url.pathname==="/api/admin/users/password"){
    const admin=requireAdmin(req,res);if(!admin)return;const input=await body(req),user=db.prepare("SELECT id,public_id,email FROM users WHERE public_id=?").get(String(input.userId||"")),password=String(input.password||"");
    if(!user)return json(res,404,{error:"User was not found."});if(!validPassword(password))return json(res,422,{error:"Use at least 8 characters with uppercase, lowercase, and a number."});
    db.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").run(await passwordHash(password),now(),user.id);db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);db.prepare("UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL").run(now(),user.id);db.prepare("INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES ('admin',?,'changed_user_password','user',?,'{}',?,?)").run(admin.email,user.public_id,requestIp(req),now());return json(res,200,{message:"User password updated. Existing sessions were signed out."});
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/investment-plans"){
    if(!requireAdmin(req,res))return;
    const plans=db.prepare("SELECT public_id,name,category,nav_cents,minimum_cents,projected_return_bps,management_fee_bps,risk_level,status,description FROM investment_plans ORDER BY status DESC,id").all();
    return json(res,200,{plans});
  }
  if(req.method==="POST"&&url.pathname==="/api/admin/investment-plans"){
    const admin=requireAdmin(req,res);if(!admin)return;const input=await body(req),id=String(input.id||""),name=String(input.name||"").trim(),category=String(input.category||"").trim(),nav=cents(input.nav),minimum=cents(input.minInvestment),returnBps=Math.round(Number(input.returnRate||70)*100),feeBps=Math.round(Number(input.managementFee||0.85)*100),risk=String(input.risk||"Medium"),status=String(input.status||"Active").toLowerCase()==="active"?"active":"inactive",description=String(input.description||"").trim();
    if(name.length<3)return json(res,422,{error:"Enter a plan name."});if(!category)return json(res,422,{error:"Enter a plan category."});if(!Number.isSafeInteger(nav)||nav<1)return json(res,422,{error:"Enter a valid NAV."});if(!Number.isSafeInteger(minimum)||minimum<100)return json(res,422,{error:"Enter a valid minimum investment."});if(!["Low","Medium","High"].includes(risk))return json(res,422,{error:"Choose a valid risk level."});
    const timestamp=now(),publicId=id||publicId("PLAN");
    db.prepare(`INSERT INTO investment_plans (public_id,name,category,nav_cents,minimum_cents,projected_return_bps,management_fee_bps,risk_level,status,description,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(public_id) DO UPDATE SET name=excluded.name,category=excluded.category,nav_cents=excluded.nav_cents,minimum_cents=excluded.minimum_cents,projected_return_bps=excluded.projected_return_bps,management_fee_bps=excluded.management_fee_bps,risk_level=excluded.risk_level,status=excluded.status,description=excluded.description,updated_at=excluded.updated_at`).run(publicId,name,category,nav,minimum,returnBps,feeBps,risk,status,description,timestamp,timestamp);
    db.prepare("INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES ('admin',?,'saved_investment_plan','investment_plan',?,?,?,?)").run(admin.email,publicId,JSON.stringify({name,status}),requestIp(req),timestamp);
    return json(res,id?200:201,{message:id?"Investment plan updated.":"Investment plan created.",planId:publicId});
  }
  if(req.method==="DELETE"&&/^\/api\/admin\/investment-plans\/[^/]+$/.test(url.pathname)){
    const admin=requireAdmin(req,res);if(!admin)return;const planId=decodeURIComponent(url.pathname.split("/")[4]),timestamp=now(),result=db.prepare("UPDATE investment_plans SET status='inactive',updated_at=? WHERE public_id=?").run(timestamp,planId);
    if(!result.changes)return json(res,404,{error:"Investment plan was not found."});
    db.prepare("INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES ('admin',?,'deactivated_investment_plan','investment_plan',?,'{}',?,?)").run(admin.email,planId,requestIp(req),timestamp);
    return json(res,200,{message:"Investment plan deactivated."});
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/payments"){
    if(!requireAdmin(req,res))return;
    const payments=db.prepare(`SELECT t.public_id AS id,t.amount_cents,t.fee_cents,t.currency,t.method,t.reference,t.status,t.created_at AS date,u.email AS customer,u.name AS customer_name
      FROM wallet_transactions t JOIN users u ON u.id=t.user_id
      WHERE t.type='deposit'
      ORDER BY t.created_at DESC LIMIT 200`).all();
    return json(res,200,{payments});
  }
  if(req.method==="POST"&&/^\/api\/admin\/payments\/[^/]+\/status$/.test(url.pathname)){
    const admin=requireAdmin(req,res);if(!admin)return;
    const paymentId=decodeURIComponent(url.pathname.split("/")[4]),input=await body(req),status=String(input.status||"").toLowerCase();
    if(!["confirmed","rejected","cancelled"].includes(status))return json(res,422,{error:"Choose a valid payment status."});
    const tx=db.prepare("SELECT * FROM wallet_transactions WHERE public_id=? AND type='deposit'").get(paymentId);
    if(!tx)return json(res,404,{error:"Payment was not found."});
    if(tx.status===status)return json(res,200,{message:`Payment already ${status}.`});
    const timestamp=now();
    db.exec("BEGIN IMMEDIATE");
    try{
      db.prepare("UPDATE wallet_transactions SET status=?,updated_at=? WHERE id=?").run(status,timestamp,tx.id);
      if(status==="confirmed"&&tx.status!=="confirmed"){
        db.prepare("UPDATE wallets SET available_cents=available_cents+?,pending_cents=max(0,pending_cents-?),version=version+1,updated_at=? WHERE id=?").run(tx.amount_cents,tx.amount_cents,timestamp,tx.wallet_id);
      } else if(["rejected","cancelled"].includes(status)&&tx.status==="pending") {
        db.prepare("UPDATE wallets SET pending_cents=max(0,pending_cents-?),version=version+1,updated_at=? WHERE id=?").run(tx.amount_cents,timestamp,tx.wallet_id);
      }
      db.prepare("INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES ('admin',?,'updated_payment_status','wallet_transaction',?,?,?,?)").run(admin.email,paymentId,JSON.stringify({status,previousStatus:tx.status}),requestIp(req),timestamp);
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error}
    const owner=db.prepare("SELECT email,name FROM users WHERE id=?").get(tx.user_id),emailSent=owner?await sendWalletEventEmail(owner,{type:"deposit",status,amountCents:tx.amount_cents,currency:tx.currency,method:tx.method,transactionId:paymentId}):false;
    return json(res,200,{message:`Payment ${status}.`,emailSent});
  }
  if(req.method==="POST"&&url.pathname==="/api/admin/payments/status"){
    const admin=requireAdmin(req,res);if(!admin)return;
    const input=await body(req),paymentId=String(input.paymentId||""),status=String(input.status||"").toLowerCase();
    if(!paymentId)return json(res,422,{error:"Payment id is required."});
    if(!["confirmed","rejected","cancelled"].includes(status))return json(res,422,{error:"Choose a valid payment status."});
    const tx=db.prepare("SELECT * FROM wallet_transactions WHERE public_id=? AND type='deposit'").get(paymentId);
    if(!tx)return json(res,404,{error:"Payment was not found."});
    if(tx.status===status)return json(res,200,{message:`Payment already ${status}.`});
    const timestamp=now();
    db.exec("BEGIN IMMEDIATE");
    try{
      db.prepare("UPDATE wallet_transactions SET status=?,updated_at=? WHERE id=?").run(status,timestamp,tx.id);
      if(status==="confirmed"&&tx.status!=="confirmed")db.prepare("UPDATE wallets SET available_cents=available_cents+?,pending_cents=max(0,pending_cents-?),version=version+1,updated_at=? WHERE id=?").run(tx.amount_cents,tx.amount_cents,timestamp,tx.wallet_id);
      else if(["rejected","cancelled"].includes(status)&&tx.status==="pending")db.prepare("UPDATE wallets SET pending_cents=max(0,pending_cents-?),version=version+1,updated_at=? WHERE id=?").run(tx.amount_cents,timestamp,tx.wallet_id);
      db.prepare("INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES ('admin',?,'updated_payment_status','wallet_transaction',?,?,?,?)").run(admin.email,paymentId,JSON.stringify({status,previousStatus:tx.status}),requestIp(req),timestamp);
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error}
    const owner=db.prepare("SELECT email,name FROM users WHERE id=?").get(tx.user_id),emailSent=owner?await sendWalletEventEmail(owner,{type:"deposit",status,amountCents:tx.amount_cents,currency:tx.currency,method:tx.method,transactionId:paymentId}):false;
    return json(res,200,{message:`Payment ${status}.`,emailSent});
  }
  if(req.method==="GET"&&url.pathname==="/api/notifications"){
    const user=requireUser(req,res);if(!user)return;
    const rows=db.prepare(`SELECT n.public_id,n.title,n.message,n.category,n.created_at,
      CASE WHEN r.read_at IS NULL THEN 0 ELSE 1 END AS is_read
      FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=?
      WHERE n.recipient_user_id IS NULL OR n.recipient_user_id=?
      ORDER BY n.created_at DESC LIMIT 50`).all(user.id,user.id);
    return json(res,200,{notifications:rows,unreadCount:rows.filter(row=>!row.is_read).length});
  }
  if(req.method==="POST"&&/^\/api\/notifications\/[^/]+\/read$/.test(url.pathname)){
    const user=requireUser(req,res);if(!user)return;const notificationId=decodeURIComponent(url.pathname.split("/")[3]),notification=db.prepare("SELECT id FROM notifications WHERE public_id=? AND (recipient_user_id IS NULL OR recipient_user_id=?)").get(notificationId,user.id);
    if(!notification)return json(res,404,{error:"Notification was not found."});
    db.prepare("INSERT INTO notification_reads (notification_id,user_id,read_at) VALUES (?,?,?) ON CONFLICT(notification_id,user_id) DO UPDATE SET read_at=excluded.read_at").run(notification.id,user.id,now());
    return json(res,200,{message:"Notification marked as read."});
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/notifications"){
    if(!requireAdmin(req,res))return;const notifications=db.prepare("SELECT n.public_id,n.title,n.message,n.category,n.created_at,u.email AS recipient FROM notifications n LEFT JOIN users u ON u.id=n.recipient_user_id ORDER BY n.created_at DESC LIMIT 100").all();return json(res,200,{notifications});
  }
  if(req.method==="POST"&&url.pathname==="/api/admin/notifications"){
    const admin=requireAdmin(req,res);if(!admin)return;const input=await body(req),title=String(input.title||"").trim(),message=String(input.message||"").trim(),category=String(input.category||"general"),recipient=String(input.recipient||"").trim().toLowerCase();
    if(title.length<3||title.length>120)return json(res,422,{error:"Enter a title between 3 and 120 characters."});if(message.length<3||message.length>2000)return json(res,422,{error:"Enter a message between 3 and 2,000 characters."});if(!["general","account","payment","investment","vehicle","security"].includes(category))return json(res,422,{error:"Select a valid notification category."});
    let recipientId=null,targetUser=null;if(recipient){targetUser=db.prepare("SELECT id,email,name FROM users WHERE email=? AND status='active'").get(recipient);if(!targetUser)return json(res,404,{error:"No active user exists with that email address."});recipientId=targetUser.id}
    const id=publicId("NTF"),timestamp=now();db.prepare("INSERT INTO notifications (public_id,recipient_user_id,title,message,category,created_by,created_at) VALUES (?,?,?,?,?,?,?)").run(id,recipientId,title,message,category,admin.email,timestamp);
    db.prepare("INSERT INTO audit_logs (actor_type,actor_id,action,entity_type,entity_id,details_json,ip_address,created_at) VALUES ('admin',?,'created_notification','notification',?,?,?,?)").run(admin.email,id,JSON.stringify({recipient:recipient||"all users",category}),requestIp(req),timestamp);
    const targets=targetUser?[targetUser]:db.prepare("SELECT id,email,name FROM users WHERE status='active' AND email_verified_at IS NOT NULL ORDER BY id").all(),delivery=await sendNotificationBatch(targets,{title,message,category});
    const baseMessage=recipient?"Notification sent to the user.":`Notification sent to ${targets.length} users.`,emailMessage=delivery.failed?` Email delivered to ${delivery.sent}; ${delivery.failed} could not be delivered.`:` Email delivered to ${delivery.sent}.`;
    return json(res,201,{message:`${baseMessage}${emailMessage}`,notificationId:id,email:delivery});
  }
  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token=cookies(req).stockprime_session;if(token)db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha256(token));
    return json(res,200,{message:"Signed out."},{"Set-Cookie":clearCookie()});
  }
  if (req.method === "GET" && url.pathname === "/api/me") {
    const user=requireUser(req,res);if(!user)return;return json(res,200,{user:userPayload(user)});
  }
  if(req.method==="GET"&&url.pathname==="/api/referrals"){
    const user=requireUser(req,res);if(!user)return;const rows=db.prepare(`SELECT r.public_id AS id,referred.name,referred.created_at AS registration_date,r.investment_status,r.commission_cents,r.status FROM referrals r JOIN users referred ON referred.id=r.referred_user_id WHERE r.referrer_user_id=? ORDER BY r.created_at DESC`).all(user.id),affiliate=db.prepare("SELECT affiliate_id,status,activated_at FROM affiliates WHERE user_id=?").get(user.id),totals=db.prepare("SELECT COUNT(*) total,COALESCE(SUM(status='pending'),0) pending,COALESCE(SUM(status='successful'),0) successful,COALESCE(SUM(commission_cents),0) earned FROM referrals WHERE referrer_user_id=?").get(user.id),withdrawals=db.prepare("SELECT COALESCE(SUM(CASE WHEN status IN ('pending','approved','paid') THEN amount_cents ELSE 0 END),0) reserved,COALESCE(SUM(CASE WHEN status='paid' THEN amount_cents ELSE 0 END),0) paid,COALESCE(SUM(CASE WHEN status='pending' THEN amount_cents ELSE 0 END),0) pending FROM affiliate_withdrawals WHERE user_id=?").get(user.id),base=`${req.headers["x-forwarded-proto"]||"http"}://${req.headers.host}`;return json(res,200,{enabled:settingEnabled("referrals_enabled"),referralCode:user.referral_code,referralLink:`${base}/register.html?ref=${encodeURIComponent(user.referral_code)}`,totalReferrals:totals.total,pendingReferrals:totals.pending,successfulReferrals:totals.successful,totalEarningsCents:totals.earned,withdrawableEarningsCents:Math.max(0,totals.earned-withdrawals.reserved),history:rows,affiliate:{id:affiliate.affiliate_id,status:affiliate.status,commissionRateBps:settingNumber("referral_commission_bps",1000),membershipFeeCents:settingNumber("affiliate_membership_fee_cents",5000),programEnabled:settingEnabled("affiliate_program_enabled"),totalEarningsCents:totals.earned,pendingEarningsCents:withdrawals.pending,paidEarningsCents:withdrawals.paid,withdrawableEarningsCents:Math.max(0,totals.earned-withdrawals.reserved)}});
  }
  if(req.method==="POST"&&url.pathname==="/api/affiliate/upgrade"){
    const user=requireUser(req,res);if(!user)return;if(!settingEnabled("affiliate_program_enabled"))return json(res,503,{error:"The affiliate program is currently unavailable."});const affiliate=db.prepare("SELECT * FROM affiliates WHERE user_id=?").get(user.id);if(affiliate.status==="active")return json(res,200,{message:"Your affiliate account is already active."});const fee=settingNumber("affiliate_membership_fee_cents",5000),wallet=db.prepare("SELECT * FROM wallets WHERE user_id=?").get(user.id),timestamp=now();if(wallet.available_cents<fee)return json(res,409,{error:`You need $${(fee/100).toFixed(2)} in your available wallet to activate affiliate membership.`});db.exec("BEGIN IMMEDIATE");try{if(fee>0){db.prepare("UPDATE wallets SET available_cents=available_cents-?,version=version+1,updated_at=? WHERE id=? AND available_cents>=?").run(fee,timestamp,wallet.id,fee);db.prepare("INSERT INTO wallet_transactions (public_id,wallet_id,user_id,type,direction,amount_cents,currency,method,reference,status,metadata_json,created_at,updated_at) VALUES (?,?,?,'adjustment','debit',?,?,'wallet','Affiliate Membership Fee','confirmed',?,?,?)").run(publicId("TXN"),wallet.id,user.id,fee,wallet.currency,JSON.stringify({kind:"affiliate_membership"}),timestamp,timestamp)}db.prepare("UPDATE affiliates SET status='active',activated_at=?,updated_at=? WHERE user_id=?").run(timestamp,timestamp,user.id);db.exec("COMMIT")}catch(error){db.exec("ROLLBACK");throw error}return json(res,200,{message:"Affiliate membership activated successfully."});
  }
  if(req.method==="POST"&&url.pathname==="/api/affiliate/withdrawals"){
    const user=requireUser(req,res);if(!user)return;const input=await body(req),amount=cents(input.amount),method=String(input.method||"").trim(),destination=String(input.destination||"").trim(),affiliate=db.prepare("SELECT status FROM affiliates WHERE user_id=?").get(user.id);if(affiliate?.status!=="active")return json(res,403,{error:"An active affiliate membership is required."});const earned=db.prepare("SELECT COALESCE(SUM(commission_cents),0) value FROM referrals WHERE referrer_user_id=?").get(user.id).value,reserved=db.prepare("SELECT COALESCE(SUM(amount_cents),0) value FROM affiliate_withdrawals WHERE user_id=? AND status IN ('pending','approved','paid')").get(user.id).value;if(!Number.isSafeInteger(amount)||amount<100)return json(res,422,{error:"Withdrawal must be at least $1.00."});if(amount>earned-reserved)return json(res,409,{error:"Withdrawal exceeds your available affiliate earnings."});if(!method||destination.length<4)return json(res,422,{error:"Enter a payment method and destination."});const timestamp=now(),id=publicId("AWW");db.prepare("INSERT INTO affiliate_withdrawals (public_id,user_id,amount_cents,method,destination,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id,user.id,amount,method,destination,timestamp,timestamp);const emailSent=await sendWalletEventEmail(user,{type:"withdrawal",status:"pending",amountCents:amount,currency:"USD",method,transactionId:id});return json(res,201,{message:"Affiliate withdrawal submitted for approval.",withdrawalId:id,emailSent});
  }
  if (req.method === "GET" && url.pathname === "/api/wallet") {
    const user=requireUser(req,res);if(!user)return;const wallet=db.prepare("SELECT * FROM wallets WHERE user_id=?").get(user.id);
    return json(res,200,{wallet:{currency:wallet.currency,availableCents:wallet.available_cents,pendingCents:wallet.pending_cents}});
  }
  if (req.method === "GET" && url.pathname === "/api/wallet/transactions") {
    const user=requireUser(req,res);if(!user)return;const rows=db.prepare("SELECT public_id,type,direction,amount_cents,fee_cents,currency,method,reference,status,created_at FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100").all(user.id);
    return json(res,200,{transactions:rows});
  }
  if (req.method === "POST" && url.pathname === "/api/wallet/deposits") {
    const user=requireUser(req,res);if(!user)return;const input=await body(req),amount=cents(input.amount),method=String(input.method||"").trim(),reference=String(input.reference||"").trim();
    if(!Number.isSafeInteger(amount)||amount<100)return json(res,422,{error:"Deposit must be at least $1.00."});
    if(!["Bitcoin","Ethereum","Litecoin","Bank Transfer","USDT"].includes(method))return json(res,422,{error:"Select a supported deposit method."});
    if(reference.length<8)return json(res,422,{error:"Enter a valid transaction reference."});
    const wallet=db.prepare("SELECT * FROM wallets WHERE user_id=?").get(user.id),id=publicId("TXN"),timestamp=now();
    db.exec("BEGIN IMMEDIATE");try{db.prepare("INSERT INTO wallet_transactions (public_id,wallet_id,user_id,type,direction,amount_cents,currency,method,reference,status,created_at,updated_at) VALUES (?,?,?,'deposit','credit',?,?,?,?, 'pending',?,?)").run(id,wallet.id,user.id,amount,wallet.currency,method,reference,timestamp,timestamp);db.prepare("UPDATE wallets SET pending_cents=pending_cents+?,version=version+1,updated_at=? WHERE id=?").run(amount,timestamp,wallet.id);db.exec("COMMIT")}catch(e){db.exec("ROLLBACK");throw e}
    audit(user.public_id,"created_deposit","wallet_transaction",id,{amount,method},req);const emailSent=await sendWalletEventEmail(user,{type:"deposit",status:"pending",amountCents:amount,currency:wallet.currency,method,transactionId:id});return json(res,201,{message:"Deposit submitted for verification.",transactionId:id,emailSent});
  }
  if (req.method === "POST" && url.pathname === "/api/wallet/withdrawals") {
    const user=requireUser(req,res);if(!user)return;const input=await body(req),amount=cents(input.amount),method=String(input.method||"").trim(),destination=String(input.destination||"").trim(),fee=Math.round(amount*.015);
    if(!Number.isSafeInteger(amount)||amount<100)return json(res,422,{error:"Withdrawal must be at least $1.00."});
    if(destination.length<6)return json(res,422,{error:"Enter a valid withdrawal destination."});
    const wallet=db.prepare("SELECT * FROM wallets WHERE user_id=?").get(user.id);if(wallet.available_cents<amount+fee)return json(res,409,{error:"Insufficient available balance."});
    const id=publicId("TXN"),timestamp=now();db.exec("BEGIN IMMEDIATE");try{const updated=db.prepare("UPDATE wallets SET available_cents=available_cents-?,pending_cents=pending_cents+?,version=version+1,updated_at=? WHERE id=? AND available_cents>=?").run(amount+fee,amount,timestamp,wallet.id,amount+fee);if(!updated.changes)throw Object.assign(new Error("Insufficient available balance."),{status:409});db.prepare("INSERT INTO wallet_transactions (public_id,wallet_id,user_id,type,direction,amount_cents,fee_cents,currency,method,reference,status,metadata_json,created_at,updated_at) VALUES (?,?,?,'withdrawal','debit',?,?,?,?,?,'pending',?,?,?)").run(id,wallet.id,user.id,amount,fee,wallet.currency,method,destination,JSON.stringify({destination}),timestamp,timestamp);db.exec("COMMIT")}catch(e){db.exec("ROLLBACK");throw e}
    audit(user.public_id,"created_withdrawal","wallet_transaction",id,{amount,method},req);const emailSent=await sendWalletEventEmail(user,{type:"withdrawal",status:"pending",amountCents:amount,feeCents:fee,currency:wallet.currency,method,transactionId:id});return json(res,201,{message:"Withdrawal request submitted.",transactionId:id,emailSent});
  }
  if (req.method === "GET" && url.pathname === "/api/investment-plans") {
    const plans=db.prepare("SELECT public_id,name,category,nav_cents,minimum_cents,maximum_cents,daily_return_bps,duration_days,projected_return_bps,management_fee_bps,risk_level,description FROM investment_plans WHERE status='active' ORDER BY id").all();return json(res,200,{plans});
  }
  if (req.method === "GET" && url.pathname === "/api/stocks/quotes") {
    const apiKey=process.env.FINNHUB_API_KEY;
    if(!apiKey)return json(res,503,{error:"Live market feed is not configured.",code:"MARKET_FEED_NOT_CONFIGURED"});
    const requested=(url.searchParams.get("symbols")||"").toUpperCase().split(",").map(s=>s.trim()).filter(Boolean),symbols=[...new Set(requested)].filter(s=>supportedStockSymbols.has(s)).slice(0,10);
    if(!symbols.length)return json(res,422,{error:"Choose at least one supported stock symbol."});
    const quotes=await Promise.all(symbols.map(async symbol=>{const cached=quoteCache.get(symbol);if(cached&&Date.now()-cached.cachedAt<30000)return cached.value;const response=await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`,{headers:{"X-Finnhub-Token":apiKey,"User-Agent":"StockPrime/1.0"},signal:AbortSignal.timeout(8000)});if(!response.ok)throw Object.assign(new Error(`Market provider returned ${response.status}.`),{status:502});const quote=await response.json();if(!Number.isFinite(quote.c)||quote.c<=0)throw Object.assign(new Error(`No live quote is available for ${symbol}.`),{status:502});const value={symbol,current:quote.c,change:quote.d,percentChange:quote.dp,high:quote.h,low:quote.l,open:quote.o,previousClose:quote.pc,timestamp:quote.t?new Date(quote.t*1000).toISOString():now()};quoteCache.set(symbol,{value,cachedAt:Date.now()});return value}));
    return json(res,200,{source:"Finnhub",realtime:true,quotes,updatedAt:now(),cacheSeconds:30});
  }
  if (req.method === "GET" && url.pathname === "/api/market-news") {
    try{return json(res,200,await marketNews())}catch(error){return json(res,error.status||500,{error:error.message,code:error.code||"MARKET_NEWS_ERROR"})}
  }
  if (req.method === "GET" && url.pathname === "/api/stock-orders") {
    const user=requireUser(req,res);if(!user)return;
    const orders=db.prepare("SELECT public_id,symbol,shares_micros,execution_price_cents,principal_cents,fee_cents,annual_roi_bps,duration_days,status,created_at FROM stock_orders WHERE user_id=? ORDER BY created_at DESC").all(user.id).map(order=>({...order,...projectedValue(order.principal_cents,order.annual_roi_bps,order.created_at),elapsedDays:Math.max(0,Math.floor((Date.now()-new Date(order.created_at).getTime())/86400000))}));
    return json(res,200,{orders});
  }
  if (req.method === "POST" && url.pathname === "/api/stock-orders") {
    const user=requireUser(req,res);if(!user)return;
    const input=await body(req),symbol=String(input.symbol||"").trim().toUpperCase(),shares=Number(input.shares),durationDays=Number(input.durationDays);
    if(!supportedStockSymbols.has(symbol))return json(res,422,{error:"Select a supported stock."});
    if(!Number.isInteger(shares)||shares<1||shares>100000)return json(res,422,{error:"Enter a valid whole number of shares."});
    if(![7,30,90].includes(durationDays))return json(res,422,{error:"Select a valid investment duration."});
    const cached=quoteCache.get(symbol);
    if(!cached||Date.now()-cached.cachedAt>120000)return json(res,409,{error:"A current live quote is required before placing this order. Refresh the market feed and try again.",code:"LIVE_QUOTE_REQUIRED"});
    const priceCents=cents(cached.value.current),principal=priceCents*shares,fee=Math.round(principal*.01),total=principal+fee,wallet=db.prepare("SELECT * FROM wallets WHERE user_id=?").get(user.id);
    if(wallet.available_cents<total)return json(res,409,{error:"Your account balance is insufficient for this stock order. Please make a deposit to continue."});
    const orderId=publicId("STK"),transactionId=publicId("TXN"),timestamp=now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const update=db.prepare("UPDATE wallets SET available_cents=available_cents-?,version=version+1,updated_at=? WHERE id=? AND available_cents>=?").run(total,timestamp,wallet.id,total);
      if(!update.changes)throw Object.assign(new Error("Insufficient available balance."),{status:409});
      const tx=db.prepare("INSERT INTO wallet_transactions (public_id,wallet_id,user_id,type,direction,amount_cents,fee_cents,currency,method,status,metadata_json,created_at,updated_at) VALUES (?,?,?,'investment','debit',?,?,?,'stock','confirmed',?,?,?)").run(transactionId,wallet.id,user.id,principal,fee,wallet.currency,JSON.stringify({assetType:"stock",symbol,shares}),timestamp,timestamp);
      db.prepare("INSERT INTO stock_orders (public_id,user_id,symbol,shares_micros,execution_price_cents,principal_cents,fee_cents,annual_roi_bps,duration_days,status,wallet_transaction_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,7000,?,'placed',?,?,?)").run(orderId,user.id,symbol,shares*1_000_000,priceCents,principal,fee,durationDays,tx.lastInsertRowid,timestamp,timestamp);
      qualifyReferral(user.id,principal);
      db.exec("COMMIT");
    } catch(error) { db.exec("ROLLBACK");throw error; }
    audit(user.public_id,"placed_stock_order","stock_order",orderId,{symbol,shares,principal,durationDays},req);
    return json(res,201,{message:"Your order has been placed.",orderId,roiPercent:70,durationDays});
  }
  if (req.method === "GET" && url.pathname === "/api/investment-orders") {
    const user=requireUser(req,res);if(!user)return;const orders=db.prepare("SELECT o.public_id,o.amount_cents,o.fee_cents,o.units_micros,o.duration_days,o.term_days,o.status,o.created_at,p.name AS plan_name,p.projected_return_bps,p.management_fee_bps,p.risk_level FROM investment_orders o JOIN investment_plans p ON p.id=o.plan_id WHERE o.user_id=? ORDER BY o.created_at DESC").all(user.id).map(order=>({...order,...investmentValue(order)}));return json(res,200,{orders});
  }
  if (req.method === "POST" && url.pathname === "/api/investment-orders") {
    const user=requireUser(req,res);if(!user)return;const input=await body(req),amount=cents(input.amount),plan=db.prepare("SELECT * FROM investment_plans WHERE public_id=? AND status='active'").get(String(input.planId||""));
    if(!plan)return json(res,404,{error:"Investment plan was not found."});
    if(!Number.isSafeInteger(amount)||amount<plan.minimum_cents)return json(res,422,{error:`Minimum investment is ${(plan.minimum_cents/100).toFixed(2)}.`});
    if(plan.maximum_cents&&amount>plan.maximum_cents)return json(res,422,{error:`Maximum investment is ${(plan.maximum_cents/100).toFixed(2)}.`});
    const durationDays=Number(plan.duration_days)||30;
    const fee=Math.round(amount*(Number(plan.management_fee_bps)||0)/10000),total=amount+fee,wallet=db.prepare("SELECT * FROM wallets WHERE user_id=?").get(user.id);if(wallet.available_cents<total)return json(res,409,{error:"Your account balance is insufficient for this investment.",code:"INSUFFICIENT_BALANCE",requiredCents:total,availableCents:wallet.available_cents,shortfallCents:total-wallet.available_cents});
    const orderId=publicId("ORD"),transactionId=publicId("TXN"),timestamp=now(),units=Math.floor((amount/plan.nav_cents)*1_000_000);
    const legacyDuration=[7,30,90].includes(durationDays)?durationDays:30;
    db.exec("BEGIN IMMEDIATE");try{const update=db.prepare("UPDATE wallets SET available_cents=available_cents-?,version=version+1,updated_at=? WHERE id=? AND available_cents>=?").run(total,timestamp,wallet.id,total);if(!update.changes)throw Object.assign(new Error("Your account balance is insufficient for this investment."),{status:409});const tx=db.prepare("INSERT INTO wallet_transactions (public_id,wallet_id,user_id,type,direction,amount_cents,fee_cents,currency,method,status,created_at,updated_at) VALUES (?,?,?,'investment','debit',?,?,?,'wallet','confirmed',?,?)").run(transactionId,wallet.id,user.id,amount,fee,wallet.currency,timestamp,timestamp);db.prepare("INSERT INTO investment_orders (public_id,user_id,plan_id,amount_cents,fee_cents,units_micros,duration_days,term_days,status,wallet_transaction_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'placed',?,?,?)").run(orderId,user.id,plan.id,amount,fee,units,legacyDuration,durationDays,tx.lastInsertRowid,timestamp,timestamp);qualifyReferral(user.id,amount);db.exec("COMMIT")}catch(e){db.exec("ROLLBACK");throw e}
    audit(user.public_id,"placed_investment_order","investment_order",orderId,{amount,plan:plan.public_id,durationDays},req);return json(res,201,{message:"Investment started successfully.",orderId,roiPercent:Number(plan.projected_return_bps)/100,durationDays});
  }
  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const user=requireUser(req,res);if(!user)return;
    const wallet=db.prepare("SELECT currency,available_cents,pending_cents FROM wallets WHERE user_id=?").get(user.id);
    const transactions=db.prepare("SELECT public_id,type,direction,amount_cents,fee_cents,currency,method,reference,status,metadata_json,created_at FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 10").all(user.id);
    const monthStart=new Date();monthStart.setUTCDate(1);monthStart.setUTCHours(0,0,0,0);
    const totals=db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='deposit' AND status='confirmed' THEN amount_cents ELSE 0 END),0) total_deposits,
      COALESCE(SUM(CASE WHEN type='withdrawal' AND status IN ('pending','processing','confirmed') THEN amount_cents ELSE 0 END),0) total_withdrawals,
      COALESCE(SUM(CASE WHEN type='withdrawal' AND status IN ('pending','processing') THEN amount_cents ELSE 0 END),0) pending_withdrawals,
      COALESCE(SUM(CASE WHEN type='bonus' AND direction='credit' AND status='confirmed' THEN amount_cents ELSE 0 END),0) bonus_cents,
      COALESCE(SUM(CASE WHEN type='deposit' AND status='confirmed' AND created_at>=? THEN amount_cents ELSE 0 END),0) month_deposits,
      COALESCE(SUM(CASE WHEN type='withdrawal' AND status IN ('pending','processing','confirmed') AND created_at>=? THEN amount_cents ELSE 0 END),0) month_withdrawals
      FROM wallet_transactions WHERE user_id=?`).get(monthStart.toISOString(),monthStart.toISOString(),user.id);
    const investmentOrders=db.prepare("SELECT o.public_id,o.amount_cents,o.fee_cents,o.duration_days,o.term_days,o.status,o.created_at,p.name AS plan_name,p.projected_return_bps FROM investment_orders o JOIN investment_plans p ON p.id=o.plan_id WHERE o.user_id=? ORDER BY o.created_at DESC").all(user.id);
    const stocks=db.prepare("SELECT public_id,symbol,shares_micros,principal_cents,fee_cents,annual_roi_bps,duration_days,status,created_at FROM stock_orders WHERE user_id=? ORDER BY created_at DESC").all(user.id);
    const investments=investmentOrders.filter(order=>!["rejected","cancelled"].includes(order.status));
    const activeStocks=stocks.filter(order=>!["rejected","cancelled"].includes(order.status));
    const investmentValues=investments.map(investmentValue);
    const stockValues=activeStocks.map(order=>({...order,...projectedValue(order.principal_cents,order.annual_roi_bps,order.created_at)}));
    const sum=(items,key)=>items.reduce((total,item)=>total+Number(item[key]||0),0);
    const lastAccess=db.prepare("SELECT MAX(created_at) value FROM sessions WHERE user_id=?").get(user.id).value||user.created_at;
    return json(res,200,{
      user:userPayload(user),lastAccess,wallet,totals,transactions,
      portfolio:{
        investedCents:sum(investmentValues,"principalCents")+sum(stockValues,"principalCents"),
        currentValueCents:sum(investmentValues,"currentValueCents")+sum(stockValues,"currentValueCents"),
        profitCents:sum(investmentValues,"profitCents")+sum(stockValues,"profitCents"),
        investmentCount:investments.length,stockCount:stocks.length,
        runningInvestmentCount:investments.filter(order=>!["completed"].includes(order.status)).length
      },
      investmentOrders:investmentOrders.map(order=>({...order,...investmentValue(order)})).slice(0,10),
      stockOrders:stocks.map(order=>({...order,...projectedValue(order.principal_cents,order.annual_roi_bps,order.created_at)})).slice(0,10)
    });
  }
  if(req.method==="GET"&&url.pathname==="/api/kyc"){
    const user=requireUser(req,res);if(!user)return;const submission=db.prepare("SELECT * FROM kyc_submissions WHERE user_id=?").get(user.id);return json(res,200,{emailVerified:true,status:submission?.status||"not_submitted",submission:kycResponse(submission)});
  }
  if(req.method==="POST"&&url.pathname==="/api/kyc"){
    const user=requireUser(req,res);if(!user)return;const input=await body(req),firstName=String(input.firstName||"").trim(),lastName=String(input.lastName||"").trim(),dateOfBirth=String(input.dateOfBirth||"").trim(),nationality=String(input.nationality||"").trim(),documentType=String(input.documentType||"").trim(),documentNumber=String(input.documentNumber||"").trim(),documentFrontName=String(input.documentFrontName||"").trim(),selfieName=String(input.selfieName||"").trim(),address=String(input.address||"").trim(),city=String(input.city||"").trim(),country=String(input.country||"").trim();
    const existing=db.prepare("SELECT * FROM kyc_submissions WHERE user_id=?").get(user.id);if(existing?.status==="approved")return json(res,409,{error:"Your identity is already verified."});if(existing?.status==="pending")return json(res,409,{error:"Your KYC application is already awaiting review."});
    if(firstName.length<1||firstName.length>80||lastName.length<1||lastName.length>80)return json(res,422,{error:"Enter your legal first and last name."});
    const birthDate=new Date(`${dateOfBirth}T00:00:00Z`),adultCutoff=new Date();adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear()-18);if(!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)||Number.isNaN(birthDate.getTime())||birthDate>adultCutoff)return json(res,422,{error:"You must be at least 18 years old to submit KYC."});
    if(nationality.length<2||nationality.length>80||country.length<2||country.length>80||city.length<2||city.length>100||address.length<5||address.length>240)return json(res,422,{error:"Complete your nationality and residential address."});
    if(!["Passport","National ID","Driver's License"].includes(documentType)||documentNumber.length<4||documentNumber.length>80)return json(res,422,{error:"Enter a valid identity document."});
    if(!documentFrontName||!selfieName||documentFrontName.length>255||selfieName.length>255)return json(res,422,{error:"Select your identity document and selfie."});
    const timestamp=now(),id=existing?.public_id||publicId("KYC");db.prepare(`INSERT INTO kyc_submissions (public_id,user_id,first_name,last_name,date_of_birth,nationality,document_type,document_number,document_front_name,selfie_name,address,city,country,status,submitted_at,reviewed_at,review_note,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,NULL,NULL,?) ON CONFLICT(user_id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,date_of_birth=excluded.date_of_birth,nationality=excluded.nationality,document_type=excluded.document_type,document_number=excluded.document_number,document_front_name=excluded.document_front_name,selfie_name=excluded.selfie_name,address=excluded.address,city=excluded.city,country=excluded.country,status='pending',submitted_at=excluded.submitted_at,reviewed_at=NULL,review_note=NULL,updated_at=excluded.updated_at`).run(id,user.id,firstName,lastName,dateOfBirth,nationality,documentType,documentNumber,documentFrontName,selfieName,address,city,country,timestamp,timestamp);
    audit(user.public_id,"submitted_kyc","kyc_submission",id,{documentType},req);const emailSent=await safeTransactionalEmail({to:user.email,kind:"kyc_submitted",subject:"Your StockPrime Global KYC application was received",html:emailTemplate({eyebrow:"Identity verification",title:"KYC application received",intro:"Your identity verification details were submitted and are now awaiting review.",actionUrl:publicUrl(req,"/kyc.html"),actionLabel:"View KYC status",note:"We will email you when the review status changes."})});return json(res,201,{message:"Your KYC application is awaiting review.",emailVerified:true,status:"pending",emailSent});
  }
  return json(res,404,{error:"API endpoint not found."});
}

function staticFile(req,res,url) {
  let pathname=decodeURIComponent(url.pathname);
  if(pathname==="/")pathname="/index.html";
  if(!path.extname(pathname))pathname += ".html";
  const file=path.resolve(root, "."+pathname);
  if(!file.startsWith(root+path.sep))return json(res,403,{error:"Forbidden."});
  fs.stat(file,(error,stat)=>{
    if(error||!stat.isFile())return json(res,404,{error:"Page not found."});
    const type=mime[path.extname(file).toLowerCase()]||"application/octet-stream";
    const baseHeaders={"Content-Type":type,"Cache-Control":type.startsWith("text/html")?"no-cache":"public, max-age=3600","X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","X-Frame-Options":"SAMEORIGIN","Accept-Ranges":"bytes"};
    if(type.startsWith("text/html")){
      fs.readFile(file,"utf8",(readError,source)=>{
        if(readError)return json(res,500,{error:"Page could not be loaded."});
        const bootstrap=source.includes("global-theme.css")?"":`<link rel="stylesheet" href="/global-theme.css?v=20260724"><script>(function(){document.documentElement.dataset.theme=localStorage.getItem("siteTheme")||"dark"})()</script>`;
        let output=source.includes("</head>")?source.replace("</head>",`${bootstrap}</head>`):bootstrap+source;
        const runtime=source.includes("global-theme.js")?"":'<script src="/global-theme.js?v=20260724"></script>';
        output=output.includes("</body>")?output.replace("</body>",`${runtime}</body>`):output+runtime;
        const bytes=Buffer.byteLength(output);res.writeHead(200,{...baseHeaders,"Content-Length":bytes});if(req.method==="HEAD")return res.end();res.end(output);
      });return;
    }
    const range=req.headers.range;
    if(range&&type.startsWith("video/")){const match=/bytes=(\d*)-(\d*)/.exec(range),start=match?.[1]?Number(match[1]):0,end=match?.[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;if(!match||start>end||start>=stat.size){res.writeHead(416,{"Content-Range":`bytes */${stat.size}`});return res.end()}res.writeHead(206,{...baseHeaders,"Content-Range":`bytes ${start}-${end}/${stat.size}`,"Content-Length":end-start+1});if(req.method==="HEAD")return res.end();return fs.createReadStream(file,{start,end}).pipe(res)}
    res.writeHead(200,{...baseHeaders,"Content-Length":stat.size});if(req.method==="HEAD")return res.end();fs.createReadStream(file).pipe(res);
  });
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
  try{if(url.pathname.startsWith("/api/"))await api(req,res,url);else if(req.method==="GET"||req.method==="HEAD")staticFile(req,res,url);else json(res,405,{error:"Method not allowed."})}
  catch(error){console.error(error);json(res,error.status||500,{error:error.status?error.message:"The server could not complete this request."})}
});
server.listen(port,()=>{const email=emailDeliveryStatus();console.log(`StockPrime running at http://localhost:${port}`);console.log(`Runtime: ${productionRuntime?"production":"development"}; email provider: ${email.provider}; configured: ${email.configured}`);if(productionRuntime&&!email.configured)console.error(`Production email configuration is incomplete. Missing: ${email.missing.join(", ")}`)});
