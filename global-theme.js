(function(){
  const isAdmin=document.body.classList.contains("admin-body");
  if(!isAdmin){
    const symbols=["BTC","ETH","SOL","DOGE","XRP","ADA","POL","LTC"],marketTicker=document.createElement("div");
    marketTicker.className="market-ticker";
    marketTicker.setAttribute("role","status");
    marketTicker.setAttribute("aria-label","Live cryptocurrency prices");
    marketTicker.innerHTML='<div class="market-ticker-label">Crypto Prices</div><div class="market-ticker-window"><div class="market-ticker-track" data-market-ticker-track></div></div>';
    document.body.prepend(marketTicker);
    document.body.classList.add("has-market-ticker");
    if(!document.querySelector(".topbar")&&!document.querySelector(".public-top-nav"))document.body.style.paddingTop="34px";
    const renderTicker=(quotes,state="")=>{
      const prices=new Map(quotes.map(item=>[item.symbol,Number(item.price)]));
      const items=symbols.map(symbol=>{const price=prices.get(symbol),display=price>0?`$${price.toLocaleString("en-US",{minimumFractionDigits:price>=1?2:4,maximumFractionDigits:price<1?6:2})}`:state||"Unavailable";return `<span class="market-ticker-item"><span class="market-ticker-symbol">${symbol}</span><span class="market-ticker-price">${display}</span></span>`}).join("");
      marketTicker.querySelector("[data-market-ticker-track]").innerHTML=items+items;
    };
    const loadPrices=async()=>{try{const response=await fetch("/api/crypto-prices",{headers:{"Accept":"application/json"}}),data=await response.json();if(!response.ok||!data.prices?.length)throw new Error(data.error||"Prices unavailable");renderTicker(data.prices);marketTicker.dataset.loaded="true"}catch{if(!marketTicker.dataset.loaded)renderTicker([],"Unavailable")}};
    renderTicker([],"Loading…");
    loadPrices();
    setInterval(loadPrices,60000);
  }

  const root=document.documentElement;
  const logos=[...document.querySelectorAll("img")].filter(image=>/^Vanguard Prime(?: logo)?$/i.test((image.alt||"").trim())||/hhb7Yj6zdj7QzEX/i.test(image.src));
  logos.forEach(image=>image.dataset.lightLogo=image.getAttribute("src"));
  const apply=theme=>{root.dataset.theme=theme;localStorage.setItem("siteTheme",theme);logos.forEach(image=>{image.src="/images/vanguardprime-logo.png";image.setAttribute("data-brand-logo","")});document.querySelectorAll("[data-global-theme-control]").forEach(button=>{button.textContent=theme==="dark"?"☀":"☾";button.title=`Switch to ${theme==="dark"?"light":"dark"} mode`;button.setAttribute("aria-label",button.title)})};
  const toggle=()=>apply(root.dataset.theme==="dark"?"light":"dark");
  window.toggleTheme=toggle;
  let control=document.querySelector("[data-theme-toggle], .top-actions button:first-child, [onclick*='toggleTheme']");
  if(control){control.dataset.globalThemeControl="";control.removeAttribute("onclick");control.onclick=event=>{event.preventDefault();event.stopImmediatePropagation();toggle()}}
  else{control=document.createElement("button");control.type="button";control.className="global-theme-toggle";control.dataset.globalThemeControl="";control.onclick=toggle;document.body.appendChild(control)}
  apply(localStorage.getItem("siteTheme")||root.dataset.theme||"dark");
  root.dataset.theme="light";
  root.classList.remove("dark");
  localStorage.removeItem("siteTheme");
  localStorage.removeItem("theme");
  window.toggleTheme=()=>{};
  document.querySelectorAll("[data-theme-toggle], [data-global-theme-control], [onclick*='toggleTheme']").forEach(control=>control.remove());

  const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const bell=[...document.querySelectorAll("button")].find(button=>button.querySelector('use[href="#bell"]'));
  if(bell){
    bell.removeAttribute("data-demo");bell.removeAttribute("data-toast");
    const drawer=document.createElement("section");drawer.className="notification-drawer";drawer.hidden=true;drawer.innerHTML='<div class="notification-drawer-head"><h2>Notifications</h2><button type="button" data-notification-close>×</button></div><div class="notification-list"><div class="notification-empty">Loading notifications…</div></div>';document.body.appendChild(drawer);
    const badge=bell.querySelector(".badge")||Object.assign(document.createElement("span"),{className:"badge"});if(!badge.parentNode)bell.appendChild(badge);
    const setBadge=count=>{badge.textContent=count;badge.hidden=!count;bell.title=count?`${count} unread notification${count===1?"":"s"}`:"No unread notifications";bell.setAttribute("aria-label",bell.title)};
    const load=async()=>{try{const response=await fetch("/api/notifications",{credentials:"same-origin"});if(!response.ok)return;const data=await response.json(),unread=Number(data.unreadCount||0);setBadge(unread);drawer.querySelector(".notification-list").innerHTML=data.notifications.length?data.notifications.map(item=>`<button class="notification-item ${item.is_read?"opened":"unread"}" data-notification-id="${escapeHtml(item.public_id)}"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><span class="notification-state">${item.is_read?"Opened":"Unread"}</span><time>${new Date(item.created_at).toLocaleString()}</time></button>`).join(""):'<div class="notification-empty">You have no notifications yet.</div>';drawer.querySelectorAll("[data-notification-id]").forEach(item=>item.onclick=async()=>{if(item.classList.contains("unread")){await fetch(`/api/notifications/${encodeURIComponent(item.dataset.notificationId)}/read`,{method:"POST",credentials:"same-origin"});item.classList.remove("unread");item.classList.add("opened");const state=item.querySelector(".notification-state");if(state)state.textContent="Opened";setBadge(Math.max(0,Number(badge.textContent||0)-1))}})}catch{}};
    bell.onclick=event=>{event.preventDefault();event.stopImmediatePropagation();drawer.hidden=!drawer.hidden;if(!drawer.hidden)load()};drawer.querySelector("[data-notification-close]").onclick=()=>drawer.hidden=true;load();setInterval(load,30000);
  }
})();
