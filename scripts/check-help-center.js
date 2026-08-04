const {chromium}=require("playwright-core");
const {spawn}=require("node:child_process");
const path=require("node:path");
const port=3210,base=`http://127.0.0.1:${port}`,chrome="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const assert=(value,message)=>{if(!value)throw new Error(message)};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
  const server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:{...process.env,PORT:String(port)},stdio:"ignore",windowsHide:true});
  let browser;
  try{
    for(let i=0;i<40;i++){try{if((await fetch(`${base}/help-center.html`)).ok)break}catch{}await wait(150)}
    browser=await chromium.launch({executablePath:chrome,headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.goto(`${base}/help-center.html`,{waitUntil:"networkidle"});
    assert(await page.locator("h1").isVisible(),"Help Center heading is not visible.");
    const colors=await page.locator(".help-category-title h3").first().evaluate(element=>({color:getComputedStyle(element).color,background:getComputedStyle(element.closest(".help-category")).backgroundColor}));
    assert(colors.color!==colors.background,"Help topic text has no visible contrast.");
    await page.fill("[data-help-search]","withdrawal");
    assert(await page.locator('details[data-search-text*="withdrawal process"]:visible').count()===1,"Help search did not isolate the withdrawal article.");
    await page.fill("[data-help-search]","");
    await page.click('[data-help-filter="wallet"]');
    assert(await page.locator('[data-category="wallet"]:visible').count()===1,"Wallet filter did not activate.");
    await page.click("[data-open-support]");
    assert(await page.locator(".support-chat").isVisible(),"Support chat did not open.");
    assert((await page.request.get(`${base}/cars.html`)).status()===404,"Removed cars page is still reachable.");
    assert((await page.request.get(`${base}/api/vehicles`)).status()===404,"Removed vehicle API is still reachable.");
    await page.setViewportSize({width:390,height:844});
    await page.goto(`${base}/help-center.html`);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert(overflow<=1,`Mobile Help Center overflows by ${overflow}px.`);
    assert(await page.locator("h1").isVisible(),"Mobile Help Center heading is not visible.");
    console.log("PASS Help Center visibility, search, filters, support chat, mobile layout, and car removal");
  }finally{if(browser)await browser.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
