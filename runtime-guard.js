(function(){
  if (location.protocol !== "file:") return;
  document.addEventListener("DOMContentLoaded", () => {
    const banner = document.createElement("section");
    banner.setAttribute("role", "alert");
    banner.style.cssText = "position:fixed;z-index:99999;inset:0;display:grid;place-items:center;padding:22px;background:rgba(23,26,32,.88);font-family:Inter,Arial,sans-serif";
    banner.innerHTML = `<div style="width:min(520px,100%);padding:28px;border-radius:12px;background:white;box-shadow:0 25px 70px rgba(0,0,0,.35)">
      <div style="width:46px;height:46px;display:grid;place-items:center;border-radius:50%;background:#fff0f2;color:#E31937;font-size:24px">!</div>
      <h2 style="margin:16px 0 8px;color:#171a20">Open the application through its server</h2>
      <p style="margin:0;color:#5c5e62;line-height:1.65">Registration, login, wallets, investments, and the database cannot work from a <code>file://</code> address. Double-click <strong>start-site.cmd</strong> in the project folder, then use <strong>http://localhost:3000</strong>.</p>
      <div style="margin-top:18px;padding:12px;border-left:3px solid #E31937;background:#fff5f6;color:#65151f;font-size:12px">This is a browser security requirement, not a registration error.</div>
    </div>`;
    document.body.appendChild(banner);
  });
})();
