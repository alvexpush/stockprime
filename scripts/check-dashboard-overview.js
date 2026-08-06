const {chromium}=require("playwright-core");
const {spawn}=require("node:child_process");
const {once}=require("node:events");
const path=require("node:path");
const db=require("../database");
const port=3218,base=`http://127.0.0.1:${port}`,chrome="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",email=`dashboard.overview.${Date.now()}@example.com`,loginCode="735104";
const environment={...process.env,PORT:String(port),NODE_ENV:"development",EMAIL_PROVIDER:""};delete environment.RESEND_API_KEY;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:environment,stdio:"ignore",windowsHide:true});

(async()=>{
  let browser;
  try{
    for(let index=0;index<40;index++){try{if((await fetch(`${base}/api/health`)).ok)break}catch{}await wait(150)}
    browser=await chromium.launch({executablePath:chrome,headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
    await page.goto(`${base}/register.html`);await page.fill("#first_name","Dashboard");await page.fill("#last_name","Overview");await page.fill("#email",email);await page.fill("#phone","+1 555 010 6652");await page.fill("#login_code",loginCode);await page.fill("#login_code_confirmation",loginCode);await page.selectOption("#country",{label:"Nigeria"});await page.click('button[type="submit"]');await page.waitForURL("**/register-confirm.html");await page.click(".verify-submit");await page.waitForURL("**/dashboard.html");
    await page.waitForFunction(()=>document.querySelector('[data-overview="username"]')?.textContent.includes("Dashboard Overview"));
    const desktop=await page.evaluate(()=>{const chart=document.querySelector(".trading-card").getBoundingClientRect(),overview=document.querySelector(".account-overview").getBoundingClientRect();return {details:document.querySelectorAll(".overview-details article").length,finances:document.querySelectorAll(".finance-card").length,plans:document.querySelectorAll(".overview-plan-row article").length,chartBelow:chart.top>=overview.bottom-1,demoText:document.body.textContent.includes("Demo activity"),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}});
    if(desktop.details!==3||desktop.finances!==3||desktop.plans!==2||!desktop.chartBelow||desktop.demoText||desktop.overflow>1)throw new Error(`Desktop dashboard overview failed: ${JSON.stringify(desktop)}`);
    await page.setViewportSize({width:390,height:844});await page.reload({waitUntil:"domcontentloaded"});await page.waitForSelector(".finance-card");const mobile=await page.evaluate(()=>{const rects=selector=>[...document.querySelectorAll(selector)].map(element=>{const rect=element.getBoundingClientRect();return {x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width)}}),finance=rects(".finance-card"),details=rects(".overview-details article"),plans=rects(".overview-plan-row article");return {cards:document.querySelectorAll(".account-overview article").length,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,finance,details,plans}});
    const compactRows=mobile.finance[1].x<mobile.finance[0].x&&mobile.finance[1].y===mobile.finance[0].y&&mobile.details[1].y===mobile.details[2].y&&mobile.plans[0].y===mobile.plans[1].y;
    if(mobile.cards!==8||mobile.overflow>1||!compactRows||mobile.finance.some(card=>card.width<150))throw new Error(`Mobile dashboard overview failed: ${JSON.stringify(mobile)}`);
    await page.goto(`${base}/index.html`);if(await page.getByText("Demo activity",{exact:true}).count())throw new Error("Demo activity label still appears on the homepage.");
    console.log("PASS reference-style dashboard overview above chart, mobile layout, and demo label removal");
  }finally{if(browser)await browser.close();server.kill();await Promise.race([once(server,"exit"),wait(1500)]);const user=db.prepare("SELECT id FROM users WHERE email=?").get(email);if(user)db.prepare("DELETE FROM users WHERE id=?").run(user.id)}
})().catch(error=>{console.error(error);process.exitCode=1});
