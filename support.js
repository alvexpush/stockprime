(function(){
  const storageKey="stockprimeSupportConversation";
  let supportSession;
  try{supportSession=JSON.parse(localStorage.getItem(storageKey)||"null")}catch{supportSession=null}

  const faqSection=[...document.querySelectorAll("section")].find(section=>section.textContent.includes("Frequently Asked Questions"));
  const layer=document.createElement("div");
  layer.className="support-chat-layer";
  layer.hidden=true;
  layer.innerHTML='<section class="support-chat" role="dialog" aria-modal="true" aria-label="Support Chat"><header class="support-chat-head"><span class="support-agent-dot">&#9679;</span><div><b>StockPrime Support</b><small>Replies appear here automatically</small></div><button type="button" aria-label="Close support chat" data-support-close>&times;</button></header><div class="support-messages" data-support-messages></div><form class="support-chat-form"><input required maxlength="500" placeholder="Type your message..." aria-label="Message"><button>Send</button></form></section>';
  document.body.appendChild(layer);
  const launch=document.createElement("button");
  launch.className="support-bot-launch";
  launch.type="button";
  launch.textContent="Support Chat";
  document.body.appendChild(launch);
  const messagesHost=layer.querySelector("[data-support-messages]"),form=layer.querySelector("form"),input=form.querySelector("input");

  function render(messages=[]){
    messagesHost.replaceChildren();
    if(!messages.length){const greeting=document.createElement("div");greeting.className="support-message";greeting.textContent="Hello. Tell us what you need help with and our support team will reply here.";messagesHost.appendChild(greeting);return}
    messages.forEach(message=>{const item=document.createElement("div");item.className=`support-message${message.senderType==="visitor"?" user":""}`;item.textContent=message.message;messagesHost.appendChild(item)});
    messagesHost.scrollTop=messagesHost.scrollHeight;
  }
  async function sync(){
    if(!supportSession)return render();
    try{const response=await fetch(`/api/support/conversations/${encodeURIComponent(supportSession.id)}/messages`,{headers:{"X-Support-Token":supportSession.token}}),payload=await response.json();if(response.status===404){supportSession=null;localStorage.removeItem(storageKey);render();return}if(!response.ok)throw new Error(payload.error||"Messages could not be loaded.");render(payload.messages)}catch(error){const notice=document.createElement("div");notice.className="support-message";notice.textContent=error.message;messagesHost.appendChild(notice)}
  }
  async function send(message,details={}){
    const url=supportSession?`/api/support/conversations/${encodeURIComponent(supportSession.id)}/messages`:"/api/support/conversations",response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...(supportSession?{"X-Support-Token":supportSession.token}:{})},body:JSON.stringify({message,...details})}),payload=await response.json();if(!response.ok)throw new Error(payload.error||"Message could not be sent.");if(!supportSession){supportSession=payload.conversation;localStorage.setItem(storageKey,JSON.stringify(supportSession))}await sync();return payload
  }
  const open=()=>{layer.hidden=false;sync();input.focus()},close=()=>{layer.hidden=true};
  launch.onclick=open;
  layer.querySelector("[data-support-close]").onclick=close;
  layer.onclick=event=>{if(event.target===layer)close()};
  form.onsubmit=async event=>{event.preventDefault();const message=input.value.trim(),button=form.querySelector("button");if(!message)return;button.disabled=true;try{await send(message);input.value=""}catch(error){const notice=document.createElement("div");notice.className="support-message";notice.textContent=error.message;messagesHost.appendChild(notice)}finally{button.disabled=false}};
  setInterval(()=>{if(!layer.hidden)sync()},3000);
  render();

  if(faqSection){faqSection.querySelectorAll(".space-y-6 > div").forEach(item=>{item.classList.add("faq-support-item");item.tabIndex=0;const activate=()=>{faqSection.querySelectorAll(".support-prompt").forEach(prompt=>prompt.remove());const prompt=document.createElement("div");prompt.className="support-prompt";prompt.innerHTML='<strong>Need help with this issue?</strong> Start a persistent conversation with our support team.<br><button type="button">Chat with Support</button>';item.appendChild(prompt);prompt.querySelector("button").onclick=event=>{event.stopPropagation();open()}};item.onclick=activate;item.onkeydown=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();activate()}}})}

  const contactForm=document.querySelector('main form[action="#"]');
  if(contactForm){contactForm.onsubmit=async event=>{event.preventDefault();contactForm.querySelectorAll(".contact-success,.contact-error").forEach(element=>element.remove());if(!contactForm.checkValidity()){contactForm.reportValidity();return}const data=Object.fromEntries(new FormData(contactForm)),notice=document.createElement("div");try{await send(`${data.subject?`[${data.subject}] `:""}${data.message||"Contact form request"}`,{name:data.name||`${data.first_name||""} ${data.last_name||""}`.trim(),email:data.email||""});notice.className="contact-success";notice.textContent="Your message is in the support inbox. Replies will appear in Support Chat.";contactForm.reset()}catch(error){notice.className="contact-error";notice.textContent=error.message}contactForm.prepend(notice)}}
})();
