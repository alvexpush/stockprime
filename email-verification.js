(function(){
  const pagePurpose=document.body.dataset.purpose;
  let state;try{state=JSON.parse(sessionStorage.getItem("stockprimeVerification")||"null")}catch{state=null}
  if(!state?.email||state.purpose!==pagePurpose){location.replace(pagePurpose==="registration"?"register.html":"login.html");return}
  const form=document.querySelector("[data-verification-form]"),input=form.code,message=document.querySelector("[data-message]"),resend=document.querySelector("[data-resend]"),dev=document.querySelector("[data-development-code]");
  document.querySelector("[data-email]").textContent=state.maskedEmail||state.email;
  const showDevelopmentCode=code=>{if(!code){dev.hidden=true;return}dev.hidden=false;dev.innerHTML=`Local development code: <strong>${code}</strong>`;input.value=code};
  showDevelopmentCode(state.developmentCode);
  const show=(text,type="")=>{message.textContent=text;message.className=`verify-message ${type}`};
  input.addEventListener("input",()=>{input.value=input.value.replace(/\D/g,"").slice(0,6)});
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(!/^\d{6}$/.test(input.value)){show("Enter the complete 6-digit code.","error");return}
    const button=form.querySelector("[type=submit]");button.disabled=true;button.textContent="Confirming…";show("");
    try{
      const endpoint=pagePurpose==="registration"?"/api/auth/verify-registration":"/api/auth/verify-login";
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({email:state.email,code:input.value})}),data=await response.json();
      if(!response.ok)throw new Error(data.error||"The code could not be confirmed.");
      localStorage.setItem("stockprimeSession",JSON.stringify({email:data.user.email,name:data.user.name,signedInAt:new Date().toISOString(),serverAuthenticated:true}));
      const existing=JSON.parse(localStorage.getItem("stockprimeProfile")||"null")||{};localStorage.setItem("stockprimeProfile",JSON.stringify({...existing,name:data.user.name,email:data.user.email,phone:data.user.phone,country:data.user.country,currency:data.user.currency}));
      sessionStorage.removeItem("stockprimeVerification");show(data.message,"success");button.textContent="Confirmed";setTimeout(()=>location.replace("dashboard.html"),850);
    }catch(error){show(error.message,"error");button.disabled=false;button.textContent=pagePurpose==="registration"?"Confirm Email":"Confirm and Sign In"}
  });
  let remaining=0,timer;
  const tick=()=>{if(remaining<=0){resend.disabled=false;resend.textContent="Resend code";clearInterval(timer);return}resend.disabled=true;resend.textContent=`Resend in ${remaining--}s`};
  const cooldown=()=>{remaining=30;tick();timer=setInterval(tick,1000)};cooldown();
  resend.onclick=async()=>{resend.disabled=true;show("Sending a new code…");try{const response=await fetch("/api/auth/resend-code",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({email:state.email,purpose:pagePurpose})}),data=await response.json();if(!response.ok)throw new Error(data.error||"A new code could not be sent.");state={...state,maskedEmail:data.maskedEmail||state.maskedEmail,developmentCode:data.developmentCode||""};sessionStorage.setItem("stockprimeVerification",JSON.stringify(state));showDevelopmentCode(state.developmentCode);show(data.message,"success");cooldown()}catch(error){show(error.message,"error");resend.disabled=false;resend.textContent="Resend code"}};
  input.focus();
})();
