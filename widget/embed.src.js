/* ProxyAI embeddable chat widget.
 * Usage:
 *   <script src="https://cdn.proxyai.app/embed.js"
 *           data-bot-id="<client_products_id>"
 *           data-api="https://rt.proxyai.app"   (optional override, defaults to prod)
 *           async></script>
 * Vanilla JS, no dependencies, all styles scoped inside Shadow DOM.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var BOT_ID = script.getAttribute("data-bot-id");
  if (!BOT_ID) {
    console.error("[proxyai] data-bot-id missing on embed script tag");
    return;
  }
  // Double-inclusion guard. This used to live in the loader snippet the
  // merchant pastes, but a script that can be included twice — two plugins, a
  // tag manager plus a hardcoded tag — has to defend itself.
  if (window.__proxyaiEmbedLoaded) return;
  window.__proxyaiEmbedLoaded = true;

  var API = (script.getAttribute("data-api") || "https://rt.proxyai.app").replace(/\/+$/, "");
  var ENDPOINT = API + "/webhook/web/" + BOT_ID;
  var SCRIPT_ORIGIN = new URL(script.src, document.baseURI).origin;
  var DEFAULT_ICON = SCRIPT_ORIGIN + "/logo.svg";

  // Stable anon identity + per-browser conversation, persisted per bot.
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function persisted(key) {
    var k = "proxyai:" + key + ":" + BOT_ID;
    try {
      var v = localStorage.getItem(k);
      if (!v) {
        v = uuid();
        localStorage.setItem(k, v);
      }
      return v;
    } catch (_) {
      return uuid(); // storage blocked: session-scoped identity
    }
  }
  // A host page that already knows who the visitor is (the ProxyAI site itself,
  // for a signed-in customer) passes the identity in, so the conversation is
  // attributed to the account instead of a fresh anonymous id per browser.
  var USER_ID = script.getAttribute("data-user-id") || persisted("user");
  // Merchant-signed identity token: proof the shopper is logged in on the
  // store, minted by the merchant's SERVER (never by this page — the runtime
  // verifies the signature). Three ways in, in precedence order:
  //   data-user-token   — token rendered into the page (WordPress plugin)
  //   data-identity-url — same-origin endpoint returning {"token": "..."}
  //                       (Shopify app proxy /apps/proxyai/session, or the
  //                       merchant's own backend)
  //   ProxyAI.identify(token) — SPAs that fetch it themselves
  // Anonymous visitors simply have no token; the bot still chats, but the
  // ticket path requires the signed-in identity.
  var USER_TOKEN = script.getAttribute("data-user-token") || "";
  var IDENTITY_URL = script.getAttribute("data-identity-url") || "";
  if (!USER_TOKEN && IDENTITY_URL) {
    fetch(IDENTITY_URL, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && typeof j.token === "string") USER_TOKEN = j.token; })
      .catch(function () {});
  }
  var CONV_ID = persisted("conv");
  var HISTORY_KEY = "proxyai:history:" + BOT_ID + ":" + CONV_ID;

  // ---------- UI ----------
  var host = document.createElement("div");
  host.id = "proxyai-widget-host";
  // Every property is !important and re-applied on tamper: host pages often
  // ship global rules (`div { position: static }`, transforms on body) or
  // modals with high z-indexes that would otherwise bury or clip the widget.
  var HOST_STYLE = {
    position: "fixed",
    bottom: "0px",
    right: "0px",
    width: "auto",
    height: "auto",
    margin: "0px",
    padding: "0px",
    border: "0px",
    transform: "none",
    filter: "none",
    clip: "auto",
    "clip-path": "none",
    opacity: "1",
    visibility: "visible",
    display: "block",
    "pointer-events": "auto",
    isolation: "isolate",
    // Max signed 32-bit z-index: nothing on the page can legally sit above it.
    "z-index": "2147483647",
  };
  function applyHostStyle() {
    for (var prop in HOST_STYLE) {
      if (Object.prototype.hasOwnProperty.call(HOST_STYLE, prop)) {
        host.style.setProperty(prop, HOST_STYLE[prop], "important");
      }
    }
  }
  applyHostStyle();

  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  document.addEventListener("DOMContentLoaded", mount);
  if (document.readyState !== "loading") mount();
  var mounted = false;
  function mount() {
    if (mounted || !document.body) return;
    mounted = true;
    document.body.appendChild(host);
    watchHost();
  }

  // SPA route changes and some cookie banners wipe or re-parent body
  // children; re-attach and restore the styles when that happens.
  function watchHost() {
    if (!window.MutationObserver) return;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        if (document.body && host.parentNode !== document.body) document.body.appendChild(host);
        applyHostStyle();
      });
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  }

  // Icons are inlined: the widget must render identically on any host page,
  // with no icon font or sprite request.
  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var ICON_MOON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var ICON_SUN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_SEND =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>';
  var ICON_IMAGE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
  var ICON_SMILE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>';
    // Eraser, not bin: fresh conversation, transcript stays in the merchant
    // inbox. No width/height (row CSS sizes icons).
  var ICON_SWEEP =
    '<svg viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.36052 0.72921C8.55578 0.533948 8.87236 0.533948 9.06763 0.72921L14.2708 5.93235C14.466 6.12761 14.466 6.4442 14.2708 6.63946L8.95513 11.9551L7.3466 13.5636C6.76081 14.1494 5.81106 14.1494 5.22528 13.5636L1.43635 9.7747C0.850563 9.18891 0.850563 8.23917 1.43635 7.65338L3.04488 6.04485L8.36052 0.72921ZM8.71407 1.78987L4.10554 6.3984L8.60157 10.8944L13.2101 6.28591L8.71407 1.78987ZM7.89447 11.6015L3.39843 7.10551L2.14346 8.36049C1.94819 8.55575 1.94819 8.87233 2.14346 9.06759L5.93238 12.8565C6.12765 13.0518 6.44423 13.0518 6.63949 12.8565L7.89447 11.6015Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>';
  var ICON_TRASH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

  root.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    "*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}" +
    // Palette. Both themes are declared as custom properties on .panel so the
    // dark toggle is one class flip, and the host page's own CSS variables can
    // never reach inside the shadow root to change them.
    ".panel{--bg:#faf8ff;--text:#131b2e;--muted:#61656b;--bot-bubble:#eef0f5;--input-bg:#f2f3ff;" +
    "--border:#c9c3da;--chip-bg:#eaedff;--head-bg:#f3f4f6;--head-text:#000;--thumb:#c8d2c4;--idle-send:#e5e7eb}" +
    ".panel.dark{--bg:#16181d;--text:#f2f2f0;--muted:#9a9ea6;--bot-bubble:#23262e;--input-bg:#1e2128;" +
    "--border:#33373f;--chip-bg:#23262e;--head-bg:#111318;--head-text:#fff;--thumb:#3a3e46;--idle-send:#30343b}" +
    ".bubble{position:fixed;bottom:24px;right:24px;width:67px;height:67px;border-radius:50%;border:none;cursor:pointer;" +
    "background:#16a34a;color:#fff;box-shadow:0 8px 24px rgba(22,163,74,.28);display:flex;align-items:center;" +
    "justify-content:center;transition:background .15s}" +
    ".bubble:hover{background:#22c55e}" +
    ".bubble svg{width:27px;height:27px}" +
    ".panel{position:fixed;bottom:104px;right:24px;width:360px;max-width:calc(100vw - 32px);height:600px;" +
    "max-height:calc(100vh - 140px);max-height:calc(100dvh - 140px);" +
    "background:var(--bg);color:var(--text);border-radius:20px;" +
    "box-shadow:0 18px 50px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden}" +
    ".panel.open{display:flex}" +
    // 100vh on iOS Safari is the *large* viewport: it excludes the URL bar and
    // bottom toolbar, so a 100vh panel is taller than the visible area and both
    // ends get clipped. dvh tracks what is actually on screen, and shrinks when
    // the keyboard opens. The vh pair stays first as the pre-dvh fallback.
    "@media (max-width:480px){.panel{bottom:0;right:0;width:100vw;max-width:100vw;" +
    "height:100vh;height:100dvh;max-height:100vh;max-height:100dvh;border-radius:0}" +
    // Keep the composer clear of the home indicator.
    ".foot{padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}}" +
    ".head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:16px 20px;" +
    "background:var(--head-bg);color:var(--head-text)}" +
    ".head .who{display:flex;align-items:center;gap:10px;min-width:0}" +
    ".head img{width:20px;height:20px;border-radius:5px;object-fit:cover;flex:none}" +
    ".head .name{font-size:14px;font-weight:600;line-height:18px}" +
    ".head .status{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.02em;opacity:.68}" +
    ".head .dot{width:6px;height:6px;border-radius:50%;background:#4ade80;animation:pulse 1.8s ease-in-out infinite}" +
    "@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}" +
    ".head .actions{display:flex;align-items:center;gap:2px}" +
    ".head .actions button{border:0;background:transparent;color:inherit;cursor:pointer;border-radius:50%;padding:6px;" +
    "display:flex;align-items:center;justify-content:center;opacity:.8}" +
    ".head .actions button:hover{opacity:1;background:rgba(127,127,127,.16)}" +
    ".head .actions svg{width:17px;height:17px}" +
    // min-height:0 lets this flex child shrink below its content height. Without
    // it the log grows to fit every message and shoves the composer off-screen.
    ".log{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;" +
    "scrollbar-width:thin;scrollbar-color:var(--thumb) transparent}" +
    ".log::-webkit-scrollbar{width:6px}" +
    ".log::-webkit-scrollbar-thumb{background:var(--thumb);border-radius:999px}" +
    // The empty state doubles as the bot's introduction.
    ".intro{display:none;flex-direction:column;align-items:center;gap:8px;padding:8px 8px 4px;text-align:center}" +
    ".intro.visible{display:flex}" +
    ".intro .tile{width:48px;height:48px;border-radius:14px;background:var(--bot-bubble);display:flex;" +
    "align-items:center;justify-content:center;color:#16a34a}" +
    ".intro .tile svg{width:24px;height:24px}" +
    ".intro .title{font-size:16px;font-weight:600;color:var(--text)}" +
    ".intro .sub{max-width:230px;font-size:13px;line-height:18px;color:var(--muted)}" +
    ".row{display:flex;align-items:flex-end;gap:8px}" +
    ".row.user{justify-content:flex-end}" +
    ".avatar{width:28px;height:28px;flex:none;border-radius:50%;background:var(--bot-bubble);color:var(--muted);" +
    "display:flex;align-items:center;justify-content:center}" +
    ".avatar svg{width:14px;height:14px}" +
    ".avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}" +
    ".who-name{margin-bottom:3px;padding:0 2px;font-size:11px;font-weight:600;color:var(--muted)}" +
    ".stack{display:flex;flex-direction:column;align-items:flex-start;min-width:0}" +
    ".row.user .stack{align-items:flex-end}" +
    ".msg{max-width:230px;padding:10px 14px;font-size:14px;line-height:20px;white-space:pre-wrap;word-break:break-word;" +
    "border-radius:4px 12px 12px 12px;background:var(--bot-bubble);color:var(--text)}" +
    ".msg.user{border-radius:12px 4px 12px 12px;background:#16a34a;color:#fff}" +
    // Tenant disclosure line. Sits outside the bubble so it reads as a note
    // about the reply, not as part of what the assistant said.
    // pre-line: the footnote may carry a second line (e.g. the off-hours
    // notice), which would otherwise collapse into the disclaimer sentence.
    ".note{margin-top:4px;padding:0 2px;max-width:230px;font-size:10px;line-height:14px;color:var(--muted);white-space:pre-line}" +
    ".time{margin-top:4px;padding:0 2px;font-size:10px;color:var(--muted)}" +
    ".sys{align-self:center;font-size:12px;color:var(--muted)}" +
    ".typing{display:flex;gap:4px;padding:10px 14px;border-radius:4px 12px 12px 12px;background:var(--bot-bubble)}" +
    ".typing span{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:dot 1.2s infinite ease-in-out}" +
    ".typing span:nth-child(2){animation-delay:.15s}.typing span:nth-child(3){animation-delay:.3s}" +
    "@keyframes dot{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}" +
    ".chips{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 6px}" +
    ".chips button{flex:none;white-space:nowrap;border:1px solid var(--border);background:var(--chip-bg);color:var(--text);" +
    "border-radius:999px;padding:6px 10px;font-size:11px;font-weight:500;cursor:pointer}" +
    ".chips button:hover{border-color:#16a34a}" +
    ".foot{flex:none;padding:6px 16px 16px}" +
    ".powered{display:none;margin-top:6px;text-align:center;font-size:11px;color:var(--muted);text-decoration:none}" +
    ".powered.visible{display:block}" +
    ".powered:hover{text-decoration:underline}" +
    ".composer{position:relative;border:1px solid var(--border);background:var(--input-bg);border-radius:16px;" +
    "padding:10px 14px 8px;box-shadow:0 1px 2px rgba(19,27,46,.03)}" +
    ".composer textarea{display:block;width:100%;max-height:96px;min-height:32px;resize:none;border:0;outline:none;" +
    "background:transparent;color:var(--text);font-size:14px;line-height:20px;padding:0 2px}" +
    // iOS Safari force-zooms the page whenever a focused form control is under
    // 16px — on tap, and on the input.focus() in openPanel(). 16px is the
    // threshold, not a style preference; do not lower it. This block must stay
    // AFTER the 14px rule above: a media query adds no specificity, so an
    // earlier override at equal specificity loses to it.
    "@media (max-width:480px){.composer textarea,.foot input,.foot select{font-size:16px}}" +
    ".composer textarea::placeholder{color:var(--muted)}" +
    ".tools{margin-top:4px;display:flex;align-items:center;justify-content:space-between}" +
    ".tools .left{display:flex;align-items:center;gap:4px}" +
    ".tools button{border:0;background:transparent;cursor:pointer;color:var(--muted);border-radius:50%;" +
    "width:36px;height:36px;display:flex;align-items:center;justify-content:center}" +
    ".tools .left button:hover{background:rgba(127,127,127,.12)}" +
    ".tools svg{width:21px;height:21px}" +
    ".image-toggle{display:none!important}" +
    ".image-toggle.visible{display:flex!important}" +
    ".send{background:#16a34a!important;color:#fff!important;width:40px!important;height:40px!important;transition:transform .12s,background .12s}" +
    ".send:disabled{background:var(--idle-send)!important;color:var(--muted)!important;transform:scale(.96);cursor:default}" +
    ".send svg{width:18px;height:18px}" +
    ".emoji-picker{position:absolute;left:0;bottom:52px;width:244px;display:none;grid-template-columns:repeat(5,1fr);" +
    "gap:4px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:16px;" +
    "box-shadow:0 14px 40px rgba(0,0,0,.2)}" +
    ".emoji-picker.open{display:grid}" +
    ".emoji-picker button{width:36px;height:36px;padding:0;border:0;background:transparent;border-radius:8px;" +
    "cursor:pointer;font-size:20px}" +
    ".emoji-picker button:hover{background:rgba(127,127,127,.12);transform:scale(1.1)}" +
    ".attachment{display:none;align-items:center;gap:8px;margin-bottom:8px;padding:8px 12px 8px 8px;" +
    "border-radius:16px;background:rgba(127,127,127,.1);font-size:12px;color:var(--text)}" +
    ".attachment.visible{display:flex}" +
    ".attachment img{width:48px;height:48px;object-fit:cover;border-radius:12px}" +
    ".attachment .meta{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}" +
    ".attachment .remove{border:0;background:transparent;cursor:pointer;color:var(--muted);border-radius:50%;padding:6px;" +
    "display:flex;align-items:center;justify-content:center}" +
    ".attachment .remove svg{width:16px;height:16px}" +
    ".image-error{display:none;margin-bottom:8px;padding:0 2px;font-size:12px;font-weight:500;color:#dc2626}" +
    ".image-error.visible{display:block}" +
    "</style>" +
    '<button class="bubble" aria-label="Open chat">' + ICON_CHAT + "</button>" +
    '<div class="panel" role="dialog" aria-label="Chat">' +
    '<div class="head"><div class="who"><img alt="">' +
    '<div><div class="name">ProxyAI</div>' +
    '<div class="status"><span class="dot"></span><span>AI Assistant &middot; Online</span></div></div></div>' +
    '<div class="actions">' +
    '<button class="sweep" type="button" aria-label="Start a new conversation" title="New conversation">' + ICON_SWEEP + "</button>" +
    '<button class="theme-toggle" type="button" aria-label="Switch to dark mode">' + ICON_MOON + "</button>" +
    '<button class="close" type="button" aria-label="Close">' + ICON_CLOSE + "</button></div></div>" +
    '<div class="log"><div class="intro"><div class="tile">' + ICON_CHAT + "</div>" +
    '<div class="title">How can I help you today?</div>' +
    '<div class="sub">Ask about channels, pricing, or setup — I&rsquo;m ready 24/7.</div></div></div>' +
    '<div class="chips"></div>' +
    '<form class="foot"><div class="composer">' +
    '<div class="attachment"><img alt="Selected attachment"><span class="meta"></span>' +
    '<button class="remove" type="button" aria-label="Remove image">' + ICON_TRASH + "</button></div>" +
    '<div class="image-error"></div>' +
    '<textarea class="msg-input" rows="1" placeholder="Message…" maxlength="4000"></textarea>' +
    '<div class="tools"><div class="left">' +
    '<input class="image-input" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden>' +
    '<button class="image-toggle" type="button" aria-label="Upload image">' + ICON_IMAGE + "</button>" +
    '<button class="emoji-toggle" type="button" aria-label="Choose emoji" aria-expanded="false">' + ICON_SMILE + "</button>" +
    '<div class="emoji-picker" role="dialog" aria-label="Choose emoji"></div></div>' +
    '<button class="send" type="submit" aria-label="Send" disabled>' + ICON_SEND + "</button>" +
    "</div></div>" +
    // Hidden until the config says otherwise, so a store that never took the
    // free add-on never renders a badge at all.
    '<a class="powered" href="https://www.proxyai.app" target="_blank" rel="noopener noreferrer">Powered by ProxyAI</a>' +
    "</form></div>";

  var bubble = root.querySelector(".bubble");
  var panel = root.querySelector(".panel");
  var logEl = root.querySelector(".log");
  var form = root.querySelector(".foot");
  var poweredEl = root.querySelector(".powered");
  var input = root.querySelector(".msg-input");
  var sendBtn = root.querySelector(".send");
  var closeBtn = root.querySelector(".head .close");
  var emojiToggle = root.querySelector(".emoji-toggle");
  var emojiPicker = root.querySelector(".emoji-picker");
  var imageToggle = root.querySelector(".image-toggle");
  var imageInput = root.querySelector(".image-input");
  var attachment = root.querySelector(".attachment");
  var attachmentImg = root.querySelector(".attachment img");
  var attachmentMeta = root.querySelector(".attachment .meta");
  var attachmentRemove = root.querySelector(".attachment .remove");
  var imageError = root.querySelector(".image-error");
  var chipsEl = root.querySelector(".chips");
  var headEl = root.querySelector(".head .name");
  var headIcon = root.querySelector(".head img");
  var introEl = root.querySelector(".intro");
  var introTitle = root.querySelector(".intro .title");
  var introSub = root.querySelector(".intro .sub");
  var themeToggle = root.querySelector(".theme-toggle");
  headIcon.src = DEFAULT_ICON;

  // Theme: explicit data-theme wins, then the visitor's own last choice, then
  // the host page's colour scheme.
  var THEME_KEY = "proxyai:theme:" + BOT_ID;
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme(theme) {
    var dark = theme === "dark";
    panel.classList.toggle("dark", dark);
    themeToggle.innerHTML = dark ? ICON_SUN : ICON_MOON;
    themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  var themeAttr = script.getAttribute("data-theme");
  var theme = themeAttr === "dark" || themeAttr === "light" ? themeAttr : storedTheme() || systemTheme();
  applyTheme(theme);
  themeToggle.addEventListener("click", function () {
    theme = theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  });

    // ---- Sweep: fresh conversation id, not a delete. Everything scoped to
    // the old id goes with it (history, handoff state) or the next
    // conversation would resume polling for it.
  var sweepBtn = root.querySelector(".sweep");
  sweepBtn.addEventListener("click", function () {
    stopLive();
    try {
      localStorage.removeItem(HISTORY_KEY);
      CONV_ID = uuid();
      localStorage.setItem("proxyai:conv:" + BOT_ID, CONV_ID);
    } catch (_) {
      CONV_ID = uuid(); // storage blocked: the new id lives for this page only
    }
    HISTORY_KEY = "proxyai:history:" + BOT_ID + ":" + CONV_ID;

    // Rebuild the empty state rather than reloading: the panel stays open and
    // the visitor's theme and draft input are left alone.
    Array.prototype.slice.call(logEl.children).forEach(function (node) {
      if (node !== introEl) logEl.removeChild(node);
    });
    sent = false;
    chipsEl.innerHTML = "";
    renderChips();
    introEl.classList.add("visible");
    input.value = "";
    clearImage();
    input.focus();
  });
  headIcon.addEventListener("error", function () { headIcon.src = DEFAULT_ICON; });
  var sent = false; // first user message hides starter chips and static intro
  var starterChips = [];

  function renderChips() {
    if (sent || chipsEl.children.length > 0) return;
    starterChips.forEach(function (label) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", function () {
        send(label);
      });
      chipsEl.appendChild(b);
    });
  }
  var restoringHistory = false;
  var selectedImage = null;
  var EMOJI = ["😀", "😊", "😂", "😍", "🥳", "😎", "🤔", "😅", "😢", "🙏", "👍", "👏", "❤️", "🔥", "✨", "🎉", "✅", "💡", "👋", "💬"];

  EMOJI.forEach(function (emoji) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = emoji;
    button.setAttribute("aria-label", "Insert " + emoji);
    button.addEventListener("click", function () {
      var start = input.selectionStart == null ? input.value.length : input.selectionStart;
      var end = input.selectionEnd == null ? start : input.selectionEnd;
      input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
      var cursor = start + emoji.length;
      input.focus();
      input.setSelectionRange(cursor, cursor);
      emojiPicker.classList.remove("open");
      emojiToggle.setAttribute("aria-expanded", "false");
    });
    emojiPicker.appendChild(button);
  });
  emojiToggle.addEventListener("click", function () {
    var open = emojiPicker.classList.toggle("open");
    emojiToggle.setAttribute("aria-expanded", String(open));
  });

  function clearImage() {
    selectedImage = null;
    imageInput.value = "";
    attachment.classList.remove("visible");
    attachmentImg.removeAttribute("src");
    syncSendState();
  }
  imageToggle.addEventListener("click", function () { imageInput.click(); });
  attachmentRemove.addEventListener("click", clearImage);
  imageInput.addEventListener("change", function () {
    var file = imageInput.files && imageInput.files[0];
    imageError.classList.remove("visible");
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      imageError.textContent = "Choose a PNG, JPG, or JPEG image.";
      imageError.classList.add("visible");
      clearImage();
      return;
    }
    if (file.size > 300 * 1024) {
      imageError.textContent = "Image must be 300 KB or smaller.";
      imageError.classList.add("visible");
      clearImage();
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      selectedImage = String(reader.result);
      attachmentImg.src = selectedImage;
      attachmentMeta.textContent = file.name + " · " + Math.ceil(file.size / 1024) + " KB";
      attachment.classList.add("visible");
      syncSendState();
    };
    reader.readAsDataURL(file);
  });

  // Bootstrap config: bot name + starter chips. Chips show until the first
  // message is sent in this session.
  fetch(API + "/webhook/web/" + BOT_ID + "/config")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (c) {
      if (!c) return;
      // The host page can render the bot's own intro (the landing hero prompts
      // with it), so publish the config rather than keeping it inside the
      // widget. Fired late, so late listeners read window.ProxyAI.config.
      widgetConfig = c;
      try {
        window.dispatchEvent(new CustomEvent("proxyai:config", { detail: c }));
      } catch (_) {}
      if (c.name) headEl.textContent = c.name;
      if (c.icon_url) headIcon.src = c.icon_url;
      if (c.intro && !sent) {
        // The bot's own intro replaces both the generic heading and the
        // generic blurb — one voice, not two.
        introTitle.textContent = c.intro;
        introSub.style.display = "none";
      }
      if (c.supports_vision) imageToggle.classList.add("visible");
      // Only ever added, never removed: a config that predates the badge has no
      // such field, and absent must read as off rather than as unknown.
      if (c.powered_by) poweredEl.classList.add("visible");
      // Kept so the chips can be put back when the visitor sweeps the
      // conversation — the config is fetched once, not per conversation.
      starterChips = Array.isArray(c.starter_chips) ? c.starter_chips : [];
      renderChips();
    })
    .catch(function () {});

  function scrollToBottom() {
    requestAnimationFrame(function () { logEl.scrollTop = logEl.scrollHeight; });
  }

  var widgetConfig = null;

  function openPanel() {
    panel.classList.add("open");
    scrollToBottom();
    input.focus();
  }

  bubble.addEventListener("click", function () {
    if (panel.classList.contains("open")) panel.classList.remove("open");
    else openPanel();
  });

    // Host-page API: the landing hero feeds the same code path embedded
    // customers get. Defined onto the existing object — plugins loading first
    // have already queued themselves on window.ProxyAI.
  var api = (window.ProxyAI = window.ProxyAI || {});
  api.open = openPanel;
  api.close = function () { panel.classList.remove("open"); };
  api.send = function (text) {
    openPanel();
    if (text && String(text).trim()) send(String(text).trim());
  };
  api.prefill = function (text) {
    openPanel();
    input.value = text == null ? "" : String(text);
  };
  // SPAs hand the merchant-signed identity token over after their own login
  // flow; pass "" on logout. The token is opaque here — the runtime verifies.
  api.identify = function (token) {
    USER_TOKEN = token == null ? "" : String(token);
  };
  // enumerable so the property still shows up in Object.keys/spread exactly as
  // it did when this was an object literal.
  Object.defineProperty(api, "config", {
    get: function () { return widgetConfig; },
    configurable: true,
    enumerable: true,
  });

  function formatTime(date) {
    var h = date.getHours();
    var m = date.getMinutes();
    var ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return h + ":" + (m < 10 ? "0" + m : m) + " " + ampm;
  }

  // One message renders as a row: bot avatar, the bubble, then the footnote and
  // timestamp stacked underneath it.
  // Set from the poll response while a human owns the conversation.
  var agentName = "";
  var agentAvatar = "";

  function add(cls, text, note, time) {
    if (cls === "sys") {
      var s = document.createElement("div");
      s.className = "sys";
      s.textContent = text;
      logEl.appendChild(s);
      scrollToBottom();
      return s;
    }
    // "agent" is a human reply: same bubble as the bot, but wearing the
    // agent's own photo and name so the customer can see the handover landed.
    var isAgent = cls === "agent";
    var side = cls === "user" ? "user" : "bot";
    var row = document.createElement("div");
    row.className = "row " + side;
    if (side === "bot") {
      var avatar = document.createElement("div");
      avatar.className = "avatar";
      if (isAgent && agentAvatar) {
        var img = document.createElement("img");
        img.src = agentAvatar;
        img.alt = "";
        // A broken photo must not leave an empty circle.
        img.addEventListener("error", function () {
          avatar.innerHTML = ICON_CHAT;
        });
        avatar.appendChild(img);
      } else {
        avatar.innerHTML = ICON_CHAT;
      }
      row.appendChild(avatar);
    }
    var stack = document.createElement("div");
    stack.className = "stack";
    if (isAgent && agentName) {
      var who = document.createElement("div");
      who.className = "who-name";
      who.textContent = agentName;
      stack.appendChild(who);
    }
    var bubble_ = document.createElement("div");
    bubble_.className = "msg " + side;
    bubble_.textContent = text;
    stack.appendChild(bubble_);
    if (note) {
      var n = document.createElement("div");
      n.className = "note";
      n.textContent = note;
      stack.appendChild(n);
    }
    var stamp = document.createElement("div");
    stamp.className = "time";
    stamp.textContent = time || formatTime(new Date());
    stack.appendChild(stamp);
    row.appendChild(stack);
    logEl.appendChild(row);
    scrollToBottom();
    if (!restoringHistory) saveHistory();
    return row;
  }

  // The typing indicator is a row like any other, so it sits in the same
  // column flow and is removed by the caller when the reply lands.
  function addTyping() {
    var row = document.createElement("div");
    row.className = "row bot";
    row.innerHTML = '<div class="avatar">' + ICON_CHAT + "</div>" +
      '<div class="typing"><span></span><span></span><span></span></div>';
    logEl.appendChild(row);
    scrollToBottom();
    return row;
  }

  function saveHistory() {
    try {
      var history = Array.prototype.map.call(logEl.querySelectorAll(".msg"), function (node) {
        var stack = node.parentNode;
        var noteEl = stack.querySelector(".note");
        var timeEl = stack.querySelector(".time");
        return {
          cls: node.classList.contains("user") ? "user" : stack.querySelector(".who-name") ? "agent" : "bot",
          text: node.textContent || "",
          note: noteEl ? noteEl.textContent || "" : "",
          time: timeEl ? timeEl.textContent || "" : "",
        };
      });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (_) {}
  }

  function restoreHistory() {
    try {
      var history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      if (!Array.isArray(history) || history.length === 0) return;
      restoringHistory = true;
      history.forEach(function (message) {
        if ((message.cls === "user" || message.cls === "bot" || message.cls === "agent") && typeof message.text === "string") {
          add(message.cls, message.text, typeof message.note === "string" ? message.note : "", message.time);
        }
      });
      restoringHistory = false;
      sent = true;
      introEl.classList.remove("visible");
      chipsEl.innerHTML = "";
      saveHistory();
    } catch (_) {
      restoringHistory = false;
    }
  }
  restoreHistory();
  if (!sent) introEl.classList.add("visible");

  function syncSendState() {
    sendBtn.disabled = !(input.value.trim() || selectedImage);
  }
  input.addEventListener("input", function () {
    // Grow with the message, up to the CSS max-height.
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
    syncSendState();
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });
  closeBtn.addEventListener("click", function () { panel.classList.remove("open"); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text && !selectedImage) return;
    input.value = "";
    input.style.height = "auto";
    send(text);
  });

    // ---- Plugin seam: page state to send with messages + commands to run.
    // Capability names and action types are opaque strings the widget just
    // forwards.
  var PLUGIN_WAIT_MS = 800;
  var PLUGIN_CONTEXT_MS = 1500;
  var MAX_ACTION_HOPS = 3;

  var expectedPlugins = (script.getAttribute("data-plugins") || "")
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(Boolean);

  var plugins = [];
  var pluginWaiters = [];

  function haveExpectedPlugins() {
    return expectedPlugins.every(function (name) {
      return plugins.some(function (p) { return p.name === name; });
    });
  }

  function acceptPlugin(p) {
    if (!p || !p.name || !p.execute) return;
    if (plugins.some(function (x) { return x.name === p.name; })) return;
    plugins.push(p);
    if (haveExpectedPlugins()) {
      pluginWaiters.splice(0).forEach(function (resolve) { resolve(); });
    }
  }

  // Registration is order-independent: a plugin script that wins the race
  // pushes onto the array before this runs, and one that loses hits the
  // replaced push afterwards. Both land in the same place.
  var registry = (window.ProxyAI = window.ProxyAI || {});
  (registry.plugins || []).forEach(acceptPlugin);
  registry.plugins = [];
  registry.plugins.push = acceptPlugin;
  registry.registerPlugin = acceptPlugin;

  // A plugin named in data-plugins that never loads must not stall the chat,
  // so the wait is bounded and the message goes without it.
  function pluginsReady() {
    if (!expectedPlugins.length || haveExpectedPlugins()) return Promise.resolve();
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function () { if (!settled) { settled = true; resolve(); } };
      pluginWaiters.push(finish);
      setTimeout(finish, PLUGIN_WAIT_MS);
    });
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function (v) { if (!settled) { settled = true; resolve(v); } };
      setTimeout(function () { finish(null); }, ms);
      Promise.resolve(promise).then(finish, function () { finish(null); });
    });
  }

  // Returns the `client` block for an outgoing message, or null when there is
  // nothing to say — null keeps the body byte-identical to the no-plugin case.
  function clientBlock() {
    if (!plugins.length) return Promise.resolve(null);

    var capabilities = [];
    plugins.forEach(function (p) {
      (p.capabilities || []).forEach(function (c) {
        if (capabilities.indexOf(c) < 0) capabilities.push(c);
      });
    });

    var contributors = plugins.filter(function (p) { return typeof p.context === "function"; });
    var contexts = contributors.map(function (p) {
      return withTimeout(Promise.resolve().then(function () { return p.context(); }), PLUGIN_CONTEXT_MS)
        .then(function (value) { return { name: p.name, value: value }; });
    });

    return Promise.all(contexts).then(function (rows) {
      var context = null;
      rows.forEach(function (row) {
        if (!row || row.value == null) return;
        context = context || {};
        context[row.name] = row.value;
      });
      if (!capabilities.length && !context) return null;
      var block = {};
      if (capabilities.length) block.capabilities = capabilities;
      if (context) block.context = context;
      return block;
    });
  }

  // An action id is executed at most once per page, so a retried or replayed
  // batch cannot repeat a side effect the shopper already got.
  var executedActions = {};

  function ownerOf(type) {
    for (var i = 0; i < plugins.length; i++) {
      if ((plugins[i].actions || []).indexOf(type) >= 0) return plugins[i];
    }
    return null;
  }

  function runActions(actions) {
    var jobs = (actions || [])
      .filter(function (a) { return a && a.id && a.type; })
      .map(function (a) {
        if (executedActions[a.id]) return { id: a.id, type: a.type, status: "duplicate" };
        var owner = ownerOf(a.type);
        // Unclaimed types are reported, never evaluated. This is the line that
        // stops the seam from becoming a remote-code channel.
        if (!owner) return { id: a.id, type: a.type, status: "unsupported" };
        executedActions[a.id] = true;
        return Promise.resolve()
          .then(function () { return owner.execute(a); })
          // The type is echoed back so the runtime can word the confirmation for
          // the action that actually ran — an added item and a quantity change
          // are not the same sentence.
          .then(function (result) { return { id: a.id, type: a.type, status: "ok", result: result }; })
          .catch(function (err) {
            return { id: a.id, type: a.type, status: "failed", error: String((err && err.message) || err) };
          });
      });
    return Promise.all(jobs);
  }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (j) {
        return { ok: r.ok, status: r.status, body: j };
      });
    });
  }

  // The runtime hands back work for the browser instead of a reply. Carry it
  // out, report what actually happened, and let the runtime write the reply
  // from the real result. The hop limit stops a misbehaving turn looping.
  function settleActions(r, hops) {
    if (!r.ok || !r.body || r.body.status !== "action_required") return Promise.resolve(r);
    if (hops >= MAX_ACTION_HOPS) return Promise.resolve({ ok: false, status: 0, body: {} });
    return runActions(r.body.actions).then(function (results) {
      return post(ENDPOINT + "/actions", {
        conversation_id: CONV_ID,
        user_id: USER_ID,
        // Ties this leg to the turn that issued the actions, so the reply is
        // recorded against the message that caused it.
        request_id: r.body.request_id,
        results: results,
      }).then(function (next) { return settleActions(next, hops + 1); });
    });
  }

  var sending = false;

  // A long tool-using turn (order lookup, ticket creation) can outlive the
  // HTTP connection — proxies and tunnels drop it, the fetch rejects, but the
  // runtime finishes the turn and persists the reply. So a network failure is
  // not a failure yet: poll for the reply that is probably still coming, and
  // only give up after a real wait. Renders assistant AND agent rows —
  // /poll returns both.
  function recoverReply(pending, sinceIso) {
    var attempts = 0;
    var maxAttempts = 30; // × 3s = 90s, longer than any sane turn
    var timer = setInterval(function () {
      attempts++;
      fetch(ENDPOINT + "/poll?conversation_id=" + encodeURIComponent(CONV_ID) +
        "&user_id=" + encodeURIComponent(USER_ID) +
        "&after=" + encodeURIComponent(sinceIso))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var msgs = (j && j.messages) || [];
          if (msgs.length) {
            clearInterval(timer);
            pending.remove();
            msgs.forEach(function (m) {
              add(m.role === "agent" ? "agent" : "bot", m.content);
            });
            return;
          }
          if (attempts >= maxAttempts) {
            clearInterval(timer);
            pending.remove();
            add("sys", "Connection failed. Please try again.");
          }
        })
        .catch(function () {
          if (attempts >= maxAttempts) {
            clearInterval(timer);
            pending.remove();
            add("sys", "Connection failed. Please try again.");
          }
        });
    }, 3000);
  }

  function send(text) {
    if (sending) return;
    sending = true;
    sent = true;
    chipsEl.innerHTML = "";
    introEl.classList.remove("visible");
    var image = selectedImage;
    add("user", (text ? text + (image ? "\n" : "") : "") + (image ? "[Image]" : ""));
    clearImage();
    var pending = addTyping();
    sendBtn.disabled = true;
    // Recovery cursor: a little before "now" so clock skew between browser
    // and server cannot hide the reply.
    var sentAt = new Date(Date.now() - 5000).toISOString();

    pluginsReady()
      .then(clientBlock)
      .then(function (client) {
        var body = { conversation_id: CONV_ID, user_id: USER_ID, text: text, image: image || undefined,
          identity_token: USER_TOKEN || undefined };
        // Only present when a plugin contributed something, so a site with no
        // plugin sends exactly what it sent before this existed.
        if (client) body.client = client;
        return post(ENDPOINT, body);
      })
      .then(function (r) { return settleActions(r, 0); })
      .then(function (r) {
        pending.remove();
        if (r.ok && r.body.status === "ok") {
          add("bot", r.body.text, r.body.footnote);
          // ticket flag: open_ticket filed a support ticket this turn. NOT a
          // handoff — the bot keeps answering; the live channel opens so desk
          // replies stream in beside it whenever an agent works the ticket.
          if (r.body.ticket) startLive();
        } else if (r.body.status === "handoff") {
          // Human-handoff add-on: the shopper is being connected to a person.
          add("sys", r.body.text || "Connecting you to a human agent.");
          startLive();
        } else if (r.body.status === "human") {
          startLive(); // agent replies asynchronously
        } else if (r.status === 402) add("sys", "This assistant is currently unavailable.");
        else if ((r.status === 403 || r.status === 429) && r.body.error) add("sys", r.body.error);
        else add("sys", "Something went wrong. Please try again.");
      })
      .catch(function () {
        // The request may well have SUCCEEDED server-side — long tool turns
        // outlive flaky connections. Keep the typing indicator and poll for
        // the persisted reply before admitting defeat; resending here is what
        // creates duplicate tickets.
        recoverReply(pending, sentAt);
      })
      .finally(function () {
        sending = false;
        syncSendState();
        input.focus();
      });
  }

  // ---- Live reply channel ------------------------------------------------
  // Opened by two DIFFERENT calls that both route replies away from the bot:
  // a human handoff (human-handoff add-on — a person is being connected) and
  // an open ticket (helpdesk add-on — no human until an agent picks the
  // ticket up at whichever desk the merchant connected). The transport is the
  // same either way: an SSE stream (/events) where the runtime pushes a
  // "sync" event — same JSON body as /poll — whenever the conversation
  // changes, whether the reply comes from the built-in ticket board, the
  // agent inbox, or an external helpdesk relaying through its webhook.
  // Polling survives only as the fallback for failed streams and
  // museum-grade browsers.
  var pollTimer = null;
  var liveES = null;
  var liveRetry = null;
  var liveBackoff = 2000;
  // Storage strings predate the ticket flow and are kept verbatim — changing
  // them would orphan every live session in flight at deploy time.
  var LIVE_KEY = "proxyai:handoff:" + BOT_ID;
  var CURSOR_KEY = "proxyai:handoff-cursor:" + BOT_ID;
  // Resume from the last message actually shown. Starting at "now" would drop
  // every agent reply that arrived while the page was closed — exactly the
  // window a handoff creates.
  var pollAfter = (function () {
    try { return localStorage.getItem(CURSOR_KEY) || new Date().toISOString(); } catch (e) { return new Date().toISOString(); }
  })();

  function liveActive() {
    try { return !!localStorage.getItem(LIVE_KEY); } catch (e) { return false; }
  }
  function applySync(j) {
    // Set before rendering: add() reads these when drawing an agent row.
    agentName = j.agent_name || agentName;
    agentAvatar = j.agent_avatar || agentAvatar;
    (j.messages || []).forEach(function (m) {
      if (m.role === "agent") add("agent", m.content);
      pollAfter = m.created_at;
    });
    if ((j.messages || []).length) { try { localStorage.setItem(CURSOR_KEY, pollAfter); } catch (e) {} }
    // The channel ends only when the server explicitly reports BOTH no human
    // owner (handoff over, or never was one) AND no open ticket. Error bodies
    // carry neither field — the opening turn persists in the background, so
    // the first sync can race it and 403; treating that as "over" would
    // permanently kill a live channel.
    if ("owner" in j && j.owner !== "human" && !j.open_ticket) stopLive();
  }

  function startLive() {
    // Seed the cursor at handoff time, not at the next reload: an agent who
    // answers while the visitor has the page closed would otherwise fall in
    // the gap between "now" and the reload, and never be shown.
    try {
      localStorage.setItem(LIVE_KEY, "1");
      if (!localStorage.getItem(CURSOR_KEY)) localStorage.setItem(CURSOR_KEY, pollAfter);
    } catch (e) {}
    connectLive();
  }
  function connectLive() {
    if (liveES || pollTimer) return;
    if (typeof EventSource === "undefined") {
      poll(); // don't make the first agent reply wait a whole interval
      pollTimer = setInterval(poll, 4000);
      return;
    }
    var es = new EventSource(ENDPOINT + "/events?conversation_id=" + encodeURIComponent(CONV_ID) +
      "&user_id=" + encodeURIComponent(USER_ID) +
      "&after=" + encodeURIComponent(pollAfter));
    liveES = es;
    es.addEventListener("sync", function (ev) {
      liveBackoff = 2000;
      try { applySync(JSON.parse(ev.data)); } catch (e) {}
    });
    // Manual reconnect instead of EventSource's built-in: the built-in retry
    // reuses the original URL, whose stale cursor would replay every message.
    es.onerror = function () {
      es.close();
      if (liveES !== es) return;
      liveES = null;
      // Either the server ended the stream (owner back to bot — applySync
      // already cleared the handoff flag, so this is a no-op) or it dropped:
      // catch up over /poll once, then redial with the fresh cursor.
      if (!liveActive()) return;
      poll();
      liveRetry = setTimeout(connectLive, liveBackoff);
      liveBackoff = Math.min(liveBackoff * 2, 30000);
    };
  }
  function stopLive() {
    try { localStorage.removeItem(LIVE_KEY); localStorage.removeItem(CURSOR_KEY); } catch (e) {}
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (liveRetry) { clearTimeout(liveRetry); liveRetry = null; }
    if (liveES) { var es = liveES; liveES = null; es.close(); }
  }
  function poll() {
    fetch(ENDPOINT + "/poll?conversation_id=" + encodeURIComponent(CONV_ID) +
      "&user_id=" + encodeURIComponent(USER_ID) +
      "&after=" + encodeURIComponent(pollAfter))
      .then(function (r) { return r.json(); })
      .then(applySync)
      .catch(function () {});
  }
  try { if (localStorage.getItem(LIVE_KEY)) startLive(); } catch (e) {}
})();
