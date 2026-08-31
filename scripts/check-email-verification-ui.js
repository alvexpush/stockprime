const {chromium}=require("playwright-core");
const {spawn}=require("node:child_process");
const {once}=require("node:events");
const path=require("node:path");
const db=require("../database");
const port=3214,base=`http://127.0.0.1:${port}`,chrome="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",email=`browser.verify.${Date.now()}@example.com`,loginCode="628194";
const environment={...process.env,PORT:String(port),NODE_ENV:"development",EMAIL_PROVIDER:""};delete environment.RESEND_API_KEY;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:environment,stdio:"ignore",windowsHide:true});

(async()=>{
  let browser;
  try{
    for(let index=0;index<40;index++){try{if((await fetch(`${base}/api/health`)).ok)break}catch{}await wait(150)}
    browser=await chromium.launch({executablePath:chrome,headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    await page.goto(`${base}/register.html`);
    await page.fill("#first_name","Browser");await page.fill("#last_name","Verification");await page.fill("#email",email);await page.fill("#phone","+1 555 010 7392");await page.fill("#login_code",loginCode);await page.fill("#login_code_confirmation",loginCode);await page.selectOption("#country",{label:"Nigeria"});
    await page.click('button[type="submit"]');await page.waitForURL("**/register-confirm.html");
    if(!(await page.locator(".delivery-tip").textContent()).includes("Spam"))throw new Error("Registration confirmation does not include inbox and spam guidance.");
    if(!/^\d{6}$/.test(await page.inputValue(".code-input")))throw new Error("Development registration code was not presented on the confirmation screen.");
    await page.click(".verify-submit");await page.waitForURL("**/dashboard.html");
    await page.evaluate(async()=>{await fetch("/api/logout",{method:"POST"});localStorage.removeItem("vanguardprimeSession")});
    await page.goto(`${base}/login.html`);await page.fill("#email",email);await page.fill("#login_code",loginCode);await page.click('button[type="submit"]');await page.waitForURL("**/login-confirm.html");
    if(!/^\d{6}$/.test(await page.inputValue(".code-input")))throw new Error("Development login code was not presented on the confirmation screen.");
    await page.click(".verify-submit");await page.waitForURL("**/dashboard.html");
    console.log("PASS registration and login both require and complete email verification on mobile");
  }finally{
    if(browser)await browser.close();server.kill();await Promise.race([once(server,"exit"),wait(1500)]);
    const user=db.prepare("SELECT id FROM users WHERE email=?").get(email);if(user)db.prepare("DELETE FROM users WHERE id=?").run(user.id);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
