=== ProxyAI ===
Contributors: proxyai
Donate link: https://www.proxyai.app/
Tags: chatbot, ai, customer support, woocommerce, live chat
Requires at least: 6.2
Tested up to: 7.0
Requires PHP: 8.1
Stable tag: 1.0.2
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

AI chat assistant that answers from your own content, hands off to a human, and adds to the cart in the shopper's browser.

== Description ==

ProxyAI adds a chat assistant to your site. It answers from your own pages and
products, hands a conversation to a human when it cannot help, and — on a
WooCommerce store — adds items to the shopper's cart in their own browser
session.

Connecting is one click from the ProxyAI screen in wp-admin. No account or
credit card is needed beforehand: connecting creates an account tied to this
domain, verified by a callback to this site.

= What it does =

* Answers visitor questions from your published posts, pages and products
* Hands off to a human, with the conversation in a shared inbox
* Adds to cart, and links to checkout, on WooCommerce stores
* Looks up a guest's order by order number and billing email
* Gives signed-in customers a support-ticket button, as a block or a shortcode
* Keeps its knowledge in step as you publish, edit and delete content

= Requirements =

This site must be reachable over HTTPS from the public internet. Connecting is
a two-way handshake — ProxyAI calls back to
`https://example.com/wp-json/proxyai/v1/confirm` to verify you control this
domain — so a local, staging or password-protected site cannot connect.

WooCommerce is optional. Without it the assistant works as a content chatbot
and the cart and order-lookup features stay switched off.

== External services ==

This plugin is a client for ProxyAI, a hosted service. It cannot function
without it, and it contacts ProxyAI in the ways described below. The service is
operated by ProxyAI at https://www.proxyai.app.

* Terms of Service: https://www.proxyai.app/terms
* Privacy Policy: https://www.proxyai.app/privacy
* Service Agreement: https://www.proxyai.app/service-agreement

**When you press "Connect to ProxyAI"**, the plugin sends this site's address,
its name, the administration email address, its WordPress version, its
WooCommerce version if installed, whether pretty permalinks are enabled, and
the plugin version. This creates an account for this domain. Nothing is sent
before you press that button.

**Every six hours while connected**, the plugin reports the same site name,
WordPress version, WooCommerce version, permalink setting and plugin version.
This is how the service knows the install is alive and which features it can
offer.

**While you use the ProxyAI screen in wp-admin**, the dashboard there — setup,
add-ons, inbox, tickets, usage, rates, settings — reads and writes through
this site's own REST API. Your server forwards each request to ProxyAI signed
with the site's secret; your browser talks only to your own site and holds no
ProxyAI credential. Nothing from the service is embedded inside wp-admin.

**When you pay by card**, your browser loads Stripe's payment form from
`https://js.stripe.com` — a PCI-compliant payment provider — and your card
details go to Stripe alone; they never touch this site or ProxyAI's servers.
Stripe receives the amount, the currency, and the email address of the
WordPress user paying. Stripe is operated by Stripe, Inc.:
Terms of Service https://stripe.com/legal/consumer, Privacy Policy
https://stripe.com/privacy. Nothing from Stripe loads until you press
"Pay by card".

**When you pay with PayPal**, PayPal's own checkout page opens in a new tab
with the amount and currency; the plugin loads no PayPal script and sees no
PayPal login. PayPal is operated by PayPal Holdings, Inc.:
User Agreement https://www.paypal.com/legalhub/useragreement-full,
Privacy Statement https://www.paypal.com/legalhub/privacy-full.

**When you upload files in wp-admin** — knowledge documents for the Knowledge
add-on, a chat-widget icon, or a support-ticket attachment — the file goes from
your server to a storage address that ProxyAI issues for that upload; your
browser talks only to your own site. These files are stored by ProxyAI under
its Privacy Policy above.

**When you open the hosted dashboard on proxyai.app** (an optional link — the
wp-admin screen covers day-to-day work), the plugin asks the service for a
one-time sign-in code over the same signed server-to-server channel, and your
browser redeems it in a new tab. The code works once and expires after a
minute.

**When the Knowledge add-on is active**, the plugin sends the URL, title and
plain-text content of your published posts, pages and products, so the
assistant can answer from them. Drafts, private posts, password-protected posts
and trashed posts are never sent. Without that add-on, no content is sent. You
can filter or exclude individual documents with the `proxyai_sync_document`
hook.

**On every front-end page view**, visitors' browsers load the chat widget from
`https://www.proxyai.app/embed.js`, and on WooCommerce stores also
`woo-cart.js`. On a page carrying the support-ticket form, they additionally
load `ticket-embed.js` from the same host. Chat messages your visitors type go
to ProxyAI to be answered. These scripts are served by the service itself and
are not bundled, because the widget and the service it talks to are versioned
together.

**When a logged-in user views a page with the assistant or the ticket form**,
the plugin places a signed token on the page carrying that user's WordPress
user ID, email address and display name, which their browser passes to ProxyAI.
This is what lets the service recognise a returning customer and tie a ticket to
their account's own email rather than one typed into a chat box. The token is
signed with a secret held by this site, so a visitor cannot forge one, and it is
issued only while the Helpdesk add-on is active. Logged-out visitors get no
token and stay anonymous.

**When a visitor asks about an order**, ProxyAI calls this site back with an
order number and a billing email address. The plugin answers only if the two
match an order here, and returns only that order's number, status, date, total,
currency, line items and tracking details. Requests must be signed with this
site's secret, and repeated failures from one address are rate limited.

== Source code ==

Everything in this plugin ships as its source. There is no build step, no
bundler and no minification: `admin/js/dashboard.js` is hand-written and runs
as-is on WordPress's bundled React (`wp.element`) and `wp.apiFetch`;
`admin/js/tickets-block.js` and `admin/css/admin.css` are likewise plain
files. The plugin includes no third-party JavaScript or CSS libraries — the
only scripts loaded from elsewhere are Stripe's, and ProxyAI's own front-end
widget, both described under External services.

The long lines you will find in `dashboard.js` are SVG icon paths and
translatable strings, not compressed code.

The same files are published, unchanged, at
https://github.com/Proxyai-team/wordpress — read, fork, or diff against the
plugin zip there.

== Frequently Asked Questions ==

= Do I need an account before installing? =

No. Connecting creates one for this domain. There is no password to set — the
site itself is the credential.

= Does it cost anything? =

The plugin and the assistant are free. Credit is only consumed while the
assistant is answering, and you can top it up from the dashboard at any time.
Every add-on, such as Knowledge and Human Handoff, can be added free of charge
in exchange for a small "Powered by ProxyAI" badge on the chat widget, or as a
one-time purchase without the badge — the feature is identical either way.

= Will it work on a local or staging site? =

No. Connecting requires ProxyAI to reach this site over HTTPS from the public
internet, which a local or password-protected site cannot satisfy.

= Does it add a "Powered by" link to my site? =

Only if you choose it. The badge is off by default, and the only way to turn it
on is to take an add-on for free in exchange for showing it. If you would
rather not show it, buy that add-on at its normal price instead — the feature
is identical either way; starting credit, where an add-on bundles some, comes
with the paid option (the WooCommerce Store add-on includes its credit on both
paths). Once taken, the badge stays for as long as you keep the add-on; write
to support if you need that changed.

= Can I turn the assistant off without uninstalling? =

Yes. The **Chat widget** switch on the ProxyAI screen in wp-admin hides it.
Hidden, the widget is not loaded for visitors at all — no script, no request.
Your bot, add-ons, credits and conversations are kept, and switching it back
on needs nothing else.

= What happens if I deactivate the plugin? =

Deactivating notifies ProxyAI and clears this site's stored credentials.
Uninstalling additionally removes every option the plugin created.

= How do I add the support-ticket form? =

Insert the **ProxyAI Support Tickets** block in the editor, or put the
`[proxyai_tickets]` shortcode on any page. Either way the page shows a single
**Open a support ticket** button; the form and the customer's own ticket
history open in a dialog on top of the page, so dropping the block into a post
does not push your content around. It is rendered fresh on every request, so
nothing personal is stored in the post itself. Only signed-in customers can
open a ticket — logged-out visitors are asked to log in first — and the form
needs the Helpdesk add-on to be active.

= Can I stop specific content being sent? =

Yes. Filter `proxyai_sync_document` and return `null` to drop a document, or an
edited array to redact it. `proxyai_enable_woo_cart` disables the cart bridge
while leaving the assistant running.

== Installation ==

1. Install and activate the plugin.
2. Open **ProxyAI** in the admin menu (under **WooCommerce** if it is installed).
3. Read what connecting sends, then press **Connect to ProxyAI**.
4. Add credit from the **Add-ons & credits** tab, and the assistant starts
   answering.

== Screenshots ==

1. The assistant answering on a storefront, with suggested questions.
2. The assistant adds an item to the shopper's cart from the conversation.
3. The cart page after the assistant added the item — same browser session, ready for checkout.
4. Human hand-off: the agent inbox in wp-admin, with an AI briefing of the conversation so far.
5. Support tickets on a kanban board — open, pending and resolved, straight from wp-admin.
6. Chatbot setup — name, model, intro message and spend at a glance.
7. Channels: web, WhatsApp, Telegram, LINE, Messenger, Instagram and Discord from one bot.

== Changelog ==

= 1.0.2 =
* WhatsApp (unofficial bridge) now pairs in place: the QR code renders inside the channel dialog and refreshes itself until scanned — no trip to the hosted dashboard.
* The Web channel dialog can upload a chat widget icon again, next to the allowed-domain field.
* Channel cards match the hosted dashboard: a link-status icon shows live connection state, and a card menu offers Reset and Recheck.
* Cart actions no longer disappear from the Store actions tab for sites that own the WooCommerce Store add-on.
* Dialogs centre over the admin content area instead of the full screen, numbered setup steps keep their numbers beside the text, and the ticket dialog's Category dropdown lines up with the fields beside it.
* Support-ticket uploads travel through the site's own REST proxy like every other dashboard call.
* Code housekeeping for the WordPress.org review: the whole plugin passes PHP_CodeSniffer's WordPress standard and Plugin Check clean.

= 1.0.1 =
* The dashboard is now fully native to wp-admin — setup, add-ons, agent inbox, ticket board, usage log, rates and settings all render locally on WordPress's own component library, with no embedded frame. Data flows through this site's REST API and is forwarded server-to-server; the browser holds no ProxyAI credential.
* The Helpdesk tab is native too: the customer-identity secret, the built-in desk with its five-step setup wizard (own-mailbox SMTP connect, reply forwarding, auto-archive, AI-written email template, ticket-form guide), and connect cards for Gorgias, Zendesk, Freshdesk and Help Scout.
* The agent inbox matches the hosted dashboard: needs-reply queue sorted by how long the customer has waited, take-over and return-to-bot, the AI briefing, AI-drafted replies, file attachments, and archive/delete with an inline confirmation.
* The ticket board is the hosted kanban: Open/Pending/Resolved columns with drag-and-drop, day grouping, search, archived view with restore, and a ticket dialog with the full thread and reply composer.
* Card payments use Stripe's embedded, PCI-compliant payment form; PayPal opens its own page in a new tab.
* Admin styles and scripts are enqueued; the admin screens carry no inline scripts or styles.
* Support tickets now open in a dialog from a single **Open a support ticket** button. Previously the form and ticket history sat inline in the page, pushing the surrounding content around.
* The ticket dialog closes with Escape, the close button or a click outside, keeps keyboard focus inside itself while open, and returns focus to the button afterwards.
* Ticket form fields are properly labelled, and the ticket list can be opened with the keyboard as well as the mouse.
* Order tracking rate-limit fix.

= 1.0.0 =
* First release.

== Upgrade Notice ==

= 1.0.1 =
The support-ticket form moves into a dialog behind an "Open a support ticket" button. The form itself is served by ProxyAI, so this reaches your site whether or not you update; updating brings the matching editor and documentation text.

= 1.0.0 =
First release.
