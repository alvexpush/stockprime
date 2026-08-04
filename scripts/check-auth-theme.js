const {chromium}=require("playwright-core");
const {spawn}=require("node:child_process");
const path=require("node:path");
const port=3212,base=`http://127.0.0.1:${port}`,chrome="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw new Error(message)};

(async()=>{
  const server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:{...process.env,PORT:String(port)},stdio:"ignore",windowsHide:true});
  let browser;
  try{
    for(let i=0;i<40;i++){try{if((await fetch(`${base}/login.html`)).ok)break}catch{}await wait(150)}
    browser=await chromium.launch({executablePath:chrome,headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    for(const name of ["login","register"]){
      await page.goto(`${base}/${name}.html`,{waitUntil:"networkidle"});
      const state=await page.evaluate(()=>({
        background:getComputedStyle(document.body).backgroundColor,
        card:getComputedStyle(document.querySelector("main>div>div")).backgroundColor,
        heading:getComputedStyle(document.querySelector("h1")).color,
        input:getComputedStyle(document.querySelector("main input:not([type=hidden])")).backgroundColor,
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
      }));
      assert(state.background==="rgb(18, 53, 47)",`${name} does not use the homepage forest background.`);
      assert(state.card!==state.heading,`${name} form heading lacks contrast.`);
      assert(state.overflow<=1,`${name} desktop overflows horizontally.`);
      assert(await page.locator("button[type=submit]").isVisible(),`${name} submit button is not visible.`);
      await page.setViewportSize({width:390,height:844});
      await page.reload({waitUntil:"networkidle"});
      assert((await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=1,`${name} mobile overflows horizontally.`);
      assert(await page.locator("button[type=submit]").isVisible(),`${name} mobile submit button is not visible.`);
      await page.setViewportSize({width:1440,height:1000});
    }
    console.log("PASS green auth theme, contrast, controls, and responsive layout");
  }finally{if(browser)await browser.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
