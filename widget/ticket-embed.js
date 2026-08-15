/*
 * ProxyAI embedded ticket form.
 *
 * Renders a "Open a support ticket" button into the host page; clicking it
 * opens a modal holding the ticket form + the signed-in customer's ticket
 * list, filing tickets straight onto the bot's built-in helpdesk board.
 *
 * The button, rather than the bare form, is what the host page gets: the block
 * is dropped into ordinary page flow (a Shopify section, a WordPress post), and
 * a two-card form sitting inline pushes the page's real content around and
 * reads as part of it. A single control keeps the host page's layout intact.
 *
 * Sibling of embed.js (the chat widget) — same script-tag configuration:
 *
 *   <div id="proxyai-tickets"></div>
 *   <script src="https://www.proxyai.app/ticket-embed.js"
 *           data-bot-id="..."               (required)
 *           data-api="https://..."          (runtime origin; default proxyai)
 *           data-target="#proxyai-tickets"  (mount selector; default creates
 *                                            a div where the script sits)
 *           data-user-token="..."           (server-minted identity token)
 *           data-identity-url="/apps/..."   (OR: URL that returns {token})
 *   ></script>
 *
 * Identity is mandatory server-side: without a valid merchant-signed token
 * the API answers 401 and this renders a "log in" note. Tokens are minted by
 * the merchant's server with the bot's identity secret — the WordPress plugin
 * and Shopify app do it automatically.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var botId = script.getAttribute("data-bot-id");
  if (!botId) return;
  var api = (script.getAttribute("data-api") || "https://www.proxyai.app").replace(/\/$/, "");
  var base = api + "/webhook/web/" + botId;
  var token = script.getAttribute("data-user-token") || "";
  var identityUrl = script.getAttribute("data-identity-url") || "";

  var root;
  var targetSel = script.getAttribute("data-target");
  if (targetSel) root = document.querySelector(targetSel);
  if (!root) {
    root = document.createElement("div");
    script.parentNode.insertBefore(root, script);
  }
  root.className = "pa-tickets";

  var css =
    // The dialog carries this class too — it lives on <body>, outside the
    // mount, so every rule below has to reach it from the same scope or the
    // form loses its styling the moment it moves into the modal.
    ".pa-tickets{font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d1929}" +
    ".pa-tickets *{box-sizing:border-box}" +
    // <dialog> + showModal() renders in the browser's top layer, which sits
    // above every stacking context on the page — including the chat bubble —
    // so there is no z-index to pick and nothing on a merchant's theme can
    // out-stack it.
    ".pa-t-dialog{border:0;background:transparent;padding:16px;margin:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh}" +
    // The UA sheet hides a closed dialog via `dialog:not([open])`, which
    // out-specifies a bare class — hence the [open] qualifier.
    ".pa-t-dialog[open]{display:flex;align-items:center;justify-content:center}" +
    ".pa-t-dialog::backdrop{background:rgba(29,25,41,.45)}" +
    ".pa-t-modal{position:relative;background:#fff;border-radius:16px;width:100%;max-width:560px;max-height:85vh;overflow:auto;padding:22px 20px 14px;box-shadow:0 24px 60px rgba(0,0,0,.28)}" +
    ".pa-t-x{position:absolute;top:8px;right:10px;border:0;background:transparent;color:#49454f;font:400 24px/1 inherit;cursor:pointer;padding:4px 9px;border-radius:8px}" +
    ".pa-t-x:hover{background:#f3f2f8}" +
    // The cards carry their own frame inline; inside the modal the modal is
    // the frame, so a second border round each card just doubles it up.
    ".pa-t-modal .pa-t-card{border:0;padding:0;margin:0 0 18px;border-radius:0}" +
    ".pa-t-card{border:1px solid #e3e1ec;border-radius:14px;padding:18px;margin:0 0 14px;background:#fff}" +
    ".pa-t-h{margin:0 0 10px;font-size:15px;font-weight:700}" +
    ".pa-tickets label{display:block;font-size:12.5px;font-weight:600;color:#49454f;margin:0 0 4px}" +
    ".pa-tickets input,.pa-tickets textarea,.pa-tickets select{width:100%;border:1px solid #cac4d0;border-radius:10px;padding:9px 12px;font:inherit;margin:0 0 12px;background:#fff;color:inherit}" +
    ".pa-tickets textarea{min-height:96px;resize:vertical}" +
    ".pa-t-btn{display:inline-block;border:0;border-radius:10px;background:#16a34a;color:#fff;font:600 13px/1 inherit;font-family:inherit;padding:11px 18px;cursor:pointer}" +
    ".pa-t-btn[disabled]{opacity:.55;cursor:not-allowed}" +
    ".pa-t-note{font-size:12.5px;color:#79747e;margin:6px 0 0}" +
    ".pa-t-err{font-size:13px;font-weight:600;color:#ba1a1a;margin:0 0 10px}" +
    ".pa-t-ok{font-size:13px;font-weight:600;color:#0d3d1f;margin:0 0 10px}" +
    ".pa-t-row{display:flex;justify-content:space-between;gap:10px;padding:10px 2px;border-top:1px solid #eceaf4;cursor:pointer}" +
    ".pa-t-row:first-of-type{border-top:0}" +
    ".pa-t-num{font-weight:700;white-space:nowrap}" +
    ".pa-t-sub{flex:1;color:#49454f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".pa-t-st{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;align-self:center;padding:3px 9px;border-radius:999px;background:#f3f4ec;color:#504e45}" +
    ".pa-t-st.open{background:#fdeece;color:#4d2e00}.pa-t-st.pending{background:#dbeafe;color:#0b3b60}.pa-t-st.resolved{background:#dff0e4;color:#0d3d1f}" +
    ".pa-t-msg{border-radius:10px;background:#f6f5fb;padding:10px 12px;margin:0 0 8px}" +
    ".pa-t-msg.agent{background:#e9f5ec}" +
    ".pa-t-meta{font-size:11px;color:#79747e;margin:0 0 3px;font-weight:600}" +
    ".pa-t-thread{padding:10px 2px 2px}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  function headers(extra) {
    var h = extra || {};
    if (token) h["X-Identity-Token"] = token;
    return h;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function statusPill(status) {
    var pill = el("span", "pa-t-st " + status, status.replace("_", " "));
    return pill;
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  // The mount point holds nothing but the trigger. The <dialog> is appended to
  // <body>, not into the mount: a host page's section wrapper routinely sets
  // overflow/transform, and a dialog nested under one is laid out against that
  // ancestor instead of the viewport.
  var trigger = el("button", "pa-t-btn pa-t-open", "Open a support ticket");
  trigger.type = "button";
  trigger.onclick = openModal;
  root.appendChild(trigger);

  // The dialog is built on open and thrown away on close, so `dialog` being
  // non-null is also the "is it open" flag.
  var dialog = null;
  var panel = null;
  var prevOverflow = "";

  function openModal() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = "pa-t-dialog pa-tickets";
    // Native modal semantics cover role and aria-modal; only the name is ours.
    dialog.setAttribute("aria-label", "Support tickets");
    var modal = el("div", "pa-t-modal");
    var close = el("button", "pa-t-x", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.onclick = dismiss;
    panel = el("div");
    modal.appendChild(close);
    modal.appendChild(panel);
    dialog.appendChild(modal);
    // The dialog fills the viewport and centres the card, so its own box IS
    // the backdrop as far as pointer events go. Keyed on mousedown's target: a
    // drag that starts on the textarea's resize handle and ends outside the
    // card is not a dismissal.
    dialog.addEventListener("mousedown", function (e) {
      if (e.target === dialog) dismiss();
    });
    // Esc closes the dialog without going through dismiss(), so teardown has
    // to hang off the event as well.
    dialog.addEventListener("close", teardown);
    document.body.appendChild(dialog);
    if (dialog.showModal) {
      // Top layer, focus containment, Esc-to-close and focus restore on close
      // are all the browser's job from here.
      dialog.showModal();
    } else {
      // Pre-2022 Safari. Non-modal, but the form still works — better than a
      // trigger button that does nothing.
      dialog.setAttribute("open", "");
    }
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    render();
  }

  // The `close` event is queued, not synchronous, so a dismissal that relied
  // on it alone would leave `dialog` set for a tick — long enough for a second
  // click on the trigger to hit the already-open guard and do nothing.
  function dismiss() {
    if (!dialog) return;
    dialog.close();
    teardown();
  }

  function teardown() {
    if (!dialog) return;
    if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    dialog = null;
    panel = null;
    // Both point into the DOM just discarded; leaving them set would make the
    // next open write into detached nodes.
    listCard = null;
    categorySelect = null;
    document.documentElement.style.overflow = prevOverflow;
  }

  function render() {
    // Identity can resolve before the shopper ever opens the modal.
    if (!panel) return;
    panel.textContent = "";
    if (!token) {
      var card = el("div", "pa-t-card");
      card.appendChild(el("p", "pa-t-note", "Log in to your account to open a support ticket."));
      panel.appendChild(card);
      return;
    }
    renderForm();
    renderList();
    // Focus lands here, not in openModal: identity can resolve after the modal
    // is already open, and that re-render throws away whatever was focused.
    var first = panel.querySelector("input,textarea");
    if (first) first.focus();
  }

  // Filled in by the list call, which carries the merchant's own categories.
  // The form renders first and populates the select when they arrive: waiting
  // on the round trip would leave the shopper looking at nothing, and the
  // server fills in a category itself if the field never gets set.
  var categorySelect = null;
  function setCategories(list) {
    if (!categorySelect || !list || !list.length) return;
    categorySelect.textContent = "";
    for (var i = 0; i < list.length; i++) {
      var opt = el("option", null, list[i]);
      opt.value = list[i];
      categorySelect.appendChild(opt);
    }
  }

  function renderForm() {
    var card = el("div", "pa-t-card");
    card.appendChild(el("h3", "pa-t-h", "Open a support ticket"));
    var err = el("p", "pa-t-err", "");
    err.style.display = "none";
    var ok = el("p", "pa-t-ok", "");
    ok.style.display = "none";

    // Labels are wired with for/id, not left floating next to their field: a
    // placeholder is not an accessible name, and an unassociated <label> gives
    // a screen reader nothing to announce.
    var subLabel = el("label", null, "Subject");
    var sub = el("input");
    sub.id = "pa-t-subject";
    subLabel.htmlFor = sub.id;
    sub.maxLength = 200;
    sub.placeholder = "One line naming the issue";
    var catLabel = el("label", null, "Category");
    categorySelect = el("select");
    categorySelect.id = "pa-t-category";
    catLabel.htmlFor = categorySelect.id;
    var issueLabel = el("label", null, "Describe the issue");
    var issue = el("textarea");
    issue.id = "pa-t-issue";
    issueLabel.htmlFor = issue.id;
    issue.maxLength = 5000;
    issue.placeholder = "What happened, and what did you expect?";
    var btn = el("button", "pa-t-btn", "Submit ticket");
    btn.type = "button";

    btn.onclick = function () {
      if (!issue.value.replace(/\s/g, "")) return;
      btn.disabled = true;
      err.style.display = "none";
      ok.style.display = "none";
      fetch(base + "/ticket", {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          subject: sub.value.trim(),
          issue: issue.value.trim(),
          category: categorySelect ? categorySelect.value : "",
        }),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok) throw new Error(d.error === "login_required" ? "Please log in first." : "Could not submit your ticket. Try again.");
            return d;
          });
        })
        .then(function (d) {
          sub.value = "";
          issue.value = "";
          ok.textContent = "Ticket " + d.ticket_number + " opened — we'll get back to you.";
          ok.style.display = "";
          renderList();
        })
        .catch(function (e) {
          err.textContent = e.message;
          err.style.display = "";
        })
        .then(function () {
          btn.disabled = false;
        });
    };

    card.appendChild(err);
    card.appendChild(ok);
    card.appendChild(subLabel);
    card.appendChild(sub);
    card.appendChild(catLabel);
    card.appendChild(categorySelect);
    card.appendChild(issueLabel);
    card.appendChild(issue);
    card.appendChild(btn);
    panel.appendChild(card);
  }

  var listCard = null;
  function renderList() {
    if (listCard) listCard.remove();
    listCard = el("div", "pa-t-card");
    listCard.appendChild(el("h3", "pa-t-h", "Your tickets"));
    var body = el("div");
    listCard.appendChild(body);
    panel.appendChild(listCard);

    fetch(base + "/tickets", { headers: headers() })
      .then(function (r) {
        if (!r.ok) throw new Error("unavailable");
        return r.json();
      })
      .then(function (d) {
        setCategories(d.categories);
        var tickets = d.tickets || [];
        if (!tickets.length) {
          body.appendChild(el("p", "pa-t-note", "No tickets yet."));
          return;
        }
        tickets.forEach(function (t) {
          var row = el("div", "pa-t-row");
          row.appendChild(el("span", "pa-t-num", t.ticket_number));
          row.appendChild(el("span", "pa-t-sub", t.subject));
          row.appendChild(el("span", "pa-t-note", fmtDate(t.created_at)));
          row.appendChild(statusPill(t.status));
          // A clickable <div> is invisible to the keyboard; the row is the only
          // way into a ticket thread, so it has to answer Enter and Space too.
          row.setAttribute("role", "button");
          row.setAttribute("tabindex", "0");
          row.setAttribute("aria-label", "Ticket " + t.ticket_number + ": " + t.subject);
          var thread = null;
          row.onclick = function () {
            if (thread) {
              thread.remove();
              thread = null;
              row.setAttribute("aria-expanded", "false");
              return;
            }
            thread = el("div", "pa-t-thread", "Loading…");
            row.parentNode.insertBefore(thread, row.nextSibling);
            row.setAttribute("aria-expanded", "true");
            loadThread(t.ticket_number, thread);
          };
          row.onkeydown = function (e) {
            if (e.key === "Enter" || e.key === " " || e.keyCode === 13 || e.keyCode === 32) {
              e.preventDefault();
              row.onclick();
            }
          };
          row.setAttribute("aria-expanded", "false");
          body.appendChild(row);
        });
      })
      .catch(function () {
        body.appendChild(el("p", "pa-t-note", "Tickets are unavailable right now."));
      });
  }

  function loadThread(num, box) {
    fetch(base + "/ticket/" + encodeURIComponent(num), { headers: headers() })
      .then(function (r) {
        if (!r.ok) throw new Error("unavailable");
        return r.json();
      })
      .then(function (d) {
        box.textContent = "";
        (d.messages || []).forEach(function (m) {
          var isAgent = m.role !== "user";
          var msg = el("div", "pa-t-msg" + (isAgent ? " agent" : ""));
          msg.appendChild(el("p", "pa-t-meta", (isAgent ? "Support" : "You") + " · " + fmtDate(m.created_at)));
          var body = el("p", null, m.content);
          body.style.margin = "0";
          body.style.whiteSpace = "pre-wrap";
          msg.appendChild(body);
          box.appendChild(msg);
        });
        var reply = el("textarea");
        reply.setAttribute("aria-label", "Reply to support");
        reply.placeholder = "Reply to support…";
        reply.maxLength = 5000;
        var send = el("button", "pa-t-btn", "Send reply");
        send.type = "button";
        send.onclick = function () {
          if (!reply.value.replace(/\s/g, "")) return;
          send.disabled = true;
          fetch(base + "/ticket/" + encodeURIComponent(num) + "/reply", {
            method: "POST",
            headers: headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ text: reply.value.trim() }),
          })
            .then(function (r) {
              if (!r.ok) throw new Error("failed");
              loadThread(num, box);
            })
            .catch(function () {
              send.disabled = false;
            });
        };
        box.appendChild(reply);
        box.appendChild(send);
      })
      .catch(function () {
        box.textContent = "Could not load this ticket.";
      });
  }

  // Public hook: SPAs and platform plugins hand the token over after their
  // own login flow settles.
  window.ProxyAITickets = {
    identify: function (t) {
      token = String(t || "");
      render();
    },
  };

  if (identityUrl && !token) {
    // Same contract as the chat widget's data-identity-url: an endpoint on
    // the host page's own origin (Shopify app proxy) answering {token: "..."}.
    fetch(identityUrl, { credentials: "same-origin" })
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .then(function (d) {
        if (d && d.token) token = d.token;
        render();
      })
      .catch(render);
  } else {
    render();
  }
})();
