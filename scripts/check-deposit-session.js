const {spawn}=require("node:child_process");
const {once}=require("node:events");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");

const port=3224,base=`http://127.0.0.1:${port}`,databasePath=path.join(os.tmpdir(),`vanguardprime-deposit-session-${process.pid}.sqlite`),email=`deposit.session.${Date.now()}@example.com`;
const environment={...process.env,PORT:String(port),DATABASE_PATH:databasePath,NODE_ENV:"development",EMAIL_PROVIDER:"development",BTC_DEPOSIT_ADDRESS:"bc1qtestdepositaddress000000000000000000000",USDT_DEPOSIT_ADDRESS:"0x1111111111111111111111111111111111111111",USDT_DEPOSIT_NETWORK:"Ethereum (ERC-20)"};
process.env.DATABASE_PATH=databasePath;const db=require("../database");
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let server;
const post=(url,payload,cookie="")=>fetch(base+url,{method:"POST",headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(payload)});

(async()=>{try{
  server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:environment,stdio:"ignore",windowsHide:true});for(let i=0;i<40;i++){try{if((await fetch(`${base}/api/health`)).ok)break}catch{}await wait(150)}
  const timestamp=new Date().toISOString(),user=db.prepare("INSERT INTO users (public_id,name,email,password_hash,country,currency,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,'USD',?,?,?)").run(`USR-${crypto.randomUUID()}`,"Deposit Session",email,"test-hash","Nigeria",timestamp,timestamp,timestamp),token=crypto.randomBytes(32).toString("base64url"),tokenHash=crypto.createHash("sha256").update(token).digest("hex");db.prepare("INSERT INTO wallets (user_id,currency,created_at,updated_at) VALUES (?,'USD',?,?)").run(user.lastInsertRowid,timestamp,timestamp);db.prepare("INSERT INTO sessions (user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?)").run(user.lastInsertRowid,tokenHash,new Date(Date.now()+3600000).toISOString(),timestamp);const cookie=`vanguardprime_session=${token}`;
  const direct=await post("/api/wallet/deposits",{amount:100,method:"Bitcoin",reference:"direct-payment-test"},cookie),directData=await direct.json();if(direct.status!==409||directData.code!=="DEPOSIT_SESSION_REQUIRED")throw new Error("Crypto deposit was accepted without a payment session.");
  const btcResponse=await post("/api/wallet/deposit-session",{symbol:"BTC",amount:100},cookie),btc=await btcResponse.json();if(btcResponse.status!==201||btc.asset.network!=="Bitcoin"||!btc.sessionId)throw new Error("BTC payment session was not created.");
  const deposit=await post("/api/wallet/deposits",{amount:100,method:"Bitcoin",reference:"session-payment-test",sessionId:btc.sessionId},cookie);if(deposit.status!==201)throw new Error(`Valid payment session was rejected: ${JSON.stringify(await deposit.json())}`);
  const reused=await post("/api/wallet/deposits",{amount:100,method:"Bitcoin",reference:"reused-payment-test",sessionId:btc.sessionId},cookie);if(reused.status!==409)throw new Error("Completed payment session could be reused.");
  const usdtResponse=await post("/api/wallet/deposit-session",{symbol:"USDT",amount:50},cookie),usdt=await usdtResponse.json();if(usdtResponse.status!==201||usdt.asset.symbol!=="USDT"||!usdt.asset.network.includes("ERC-20"))throw new Error("USDT payment session was not created with its network.");
  const lifetime=new Date(usdt.expiresAt).getTime()-Date.now();if(lifetime<29*60*1000||lifetime>30*60*1000+2000)throw new Error(`Payment session does not expire in 30 minutes (${lifetime}ms).`);
  console.log("PASS BTC/USDT deposits require single-use 30-minute payment sessions");
}finally{if(server){server.kill();await Promise.race([once(server,"exit"),wait(1000)])}for(const suffix of ["","-shm","-wal"]){try{fs.rmSync(databasePath+suffix,{force:true})}catch{}}}})().catch(error=>{console.error(error);process.exitCode=1});
