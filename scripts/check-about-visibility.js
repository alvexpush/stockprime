const {chromium}=require("playwright-core");
const {spawn}=require("node:child_process");
const path=require("node:path");
const port=3216,base=`http://127.0.0.1:${port}`,chrome="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
  const server=spawn(process.execPath,["server.js"],{cwd:path.join(__dirname,".."),env:{...process.env,PORT:String(port)},stdio:"ignore",windowsHide:true});let browser;
  try{
    for(let index=0;index<30;index++){try{if((await fetch(`${base}/about.html`)).ok)break}catch{}await wait(150)}
    browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.goto(`${base}/about.html`,{waitUntil:"networkidle"});
    const result=await page.evaluate(()=>{const section=document.querySelector(".about-values"),heading=section.querySelector("h2"),copy=section.querySelector("p");return {background:getComputedStyle(section).backgroundColor,heading:getComputedStyle(heading).color,copy:getComputedStyle(copy).color,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}});
    if(result.background!=="rgb(247, 248, 245)"||result.heading===result.background||result.copy===result.background||result.overflow>1)throw new Error(`About page visibility failed: ${JSON.stringify(result)}`);
    await page.setViewportSize({width:390,height:844});await page.reload({waitUntil:"networkidle"});if(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1))throw new Error("About page overflows on mobile.");
    console.log("PASS About page contrast and responsive layout");
  }finally{if(browser)await browser.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
