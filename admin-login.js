(function(){
  const form=document.querySelector("[data-admin-login]"),error=document.querySelector("[data-login-error]");
  (async()=>{if(!localStorage.getItem("stockprimeAdminSession"))return;try{const response=await fetch("/api/admin/payments",{credentials:"same-origin"});if(response.ok){location.replace("admin.html");return}}catch{}localStorage.removeItem("stockprimeAdminSession")})();
  document.querySelector("[data-show-password]").onclick=()=>{const input=form.password,show=input.type==="password";input.type=show?"text":"password";document.querySelector("[data-show-password]").textContent=show?"Hide":"Show"};
  form.onsubmit=async event=>{
    event.preventDefault();error.textContent="";const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent="Authenticating…";
    try{
      const response=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({email:form.email.value.trim(),password:form.password.value})}),data=await response.json();
      if(!response.ok)throw new Error(data.error||"Administrator sign-in failed.");
      localStorage.setItem("stockprimeAdminSession",JSON.stringify({...data.admin,signedInAt:new Date().toISOString()}));location.replace("admin.html");
    }catch(failure){error.textContent=failure.message}
    finally{button.disabled=false;button.textContent="Sign in to Admin"}
  };
})();
