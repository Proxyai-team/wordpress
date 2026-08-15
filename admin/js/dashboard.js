/**
 * Native ProxyAI dashboard for wp-admin.
 *
 * This file is the source. It is hand-written and not generated: there is no
 * build step, bundler or minifier — it runs as-is on WordPress's bundled
 * React (`wp.element`, createElement) and `wp.apiFetch`. Long lines below are
 * SVG icon paths and translatable strings.
 *
 * Every request goes to this site's own REST API
 * (`proxyai/v1/admin/*`), cookie-authenticated and nonce-checked; PHP
 * forwards allowlisted calls to ProxyAI server-to-server. The browser holds
 * no ProxyAI credential. The only external script is Stripe.js, loaded only
 * when a card payment starts.
 */
(function (wp) {
  'use strict';

  var element = wp.element;
  var el = element.createElement;
  var Fragment = element.Fragment;
  var useState = element.useState;
  var useEffect = element.useEffect;
  var useCallback = element.useCallback;
  var useRef = element.useRef;
  var apiFetch = wp.apiFetch;
  var __ = wp.i18n.__;
  var sprintf = wp.i18n.sprintf;

  var CFG = window.ProxyAIDash || {};

  // ------------------------------------------------------------------
  // Data layer
  // ------------------------------------------------------------------

  function api(path, options) {
    options = options || {};
    var req = { path: '/proxyai/v1/admin/' + path };
    if (options.method) req.method = options.method;
    if (options.data !== undefined) req.data = options.data;
    return apiFetch(req);
  }

  /**
   * Status code from a failed apiFetch call. WordPress REST errors carry it
   * on `.data.status`; proxied app errors carry it top-level as `.status`
   * (or not at all — then match on `.error`, see errorOf).
   */
  function statusOf(err) {
    return (err && ((err.data && err.data.status) || err.status)) || 0;
  }

  /** The app error code from a failed apiFetch call, e.g. 'already_owned'. */
  function errorOf(err) {
    return (err && err.error) || '';
  }

  function money(n) {
    n = Number(n) || 0;
    if (n === 0) return '$0.00';
    if (n < 0.01) return '$' + n.toFixed(4);
    return '$' + n.toFixed(2);
  }

  function fmtDate(v) {
    if (!v) return '—';
    var d = new Date(v);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  // ------------------------------------------------------------------
  // Small building blocks
  // ------------------------------------------------------------------

  function Card(props) {
    return el('section', { className: 'pa-card' }, props.children);
  }

  function CardTitle(props) {
    return el(
      Fragment,
      null,
      el('h2', { className: 'pa-card__title' }, props.title),
      props.sub ? el('p', { className: 'pa-card__sub' }, props.sub) : null
    );
  }

  function Spinner() {
    return el('div', { className: 'pa-spinner' }, el('span', { className: 'spinner is-active' }));
  }

  function Notice(props) {
    return el(
      'div',
      { className: 'pa-notice pa-notice--' + (props.kind || 'info') },
      props.children
    );
  }

  function Button(props) {
    var cls = 'pa-btn';
    if (props.variant) cls += ' pa-btn--' + props.variant;
    return el(
      'button',
      {
        type: 'button',
        className: cls,
        disabled: props.disabled || props.busy,
        onClick: props.onClick,
        title: props.title,
      },
      props.busy ? el('span', { className: 'spinner is-active pa-btn__spin' }) : null,
      props.children
    );
  }

  function Field(props) {
    return el(
      'label',
      { className: 'pa-field' },
      el('span', { className: 'pa-field__label' },
        props.label,
        props.labelAction ? el('span', { className: 'pa-field__action' }, props.labelAction) : null),
      props.children,
      props.hint ? el('span', { className: 'pa-field__hint' }, props.hint) : null
    );
  }

  function TextInput(props) {
    return el('input', {
      type: props.type || 'text',
      className: 'pa-input',
      value: props.value == null ? '' : props.value,
      placeholder: props.placeholder,
      onChange: function (e) { props.onChange(e.target.value); },
      min: props.min,
      max: props.max,
      step: props.step,
    });
  }

  function TextArea(props) {
    return el('textarea', {
      className: 'pa-input pa-input--area',
      rows: props.rows || 4,
      value: props.value == null ? '' : props.value,
      placeholder: props.placeholder,
      onChange: function (e) { props.onChange(e.target.value); },
    });
  }

  function Toggle(props) {
    return el(
      'button',
      {
        type: 'button',
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        disabled: props.disabled,
        className: 'pa-toggle' + (props.checked ? ' is-on' : ''),
        onClick: function () { props.onChange(!props.checked); },
      },
      el('span', { className: 'pa-toggle__thumb' })
    );
  }

  function SelectInput(props) {
    return el(
      'select',
      {
        className: 'pa-input' + (props.className ? ' ' + props.className : ''),
        value: props.value == null ? '' : props.value,
        onChange: function (e) { props.onChange(e.target.value); },
      },
      (props.options || []).map(function (o) {
        return el('option', { key: o.value, value: o.value }, o.label);
      })
    );
  }

  /** Save bar shared by config sections: idle → saving → saved/error. */
  function useSave(section, botId) {
    var s = useState('idle');
    var state = s[0];
    var setState = s[1];
    var save = useCallback(function (data) {
      setState('saving');
      return api('bots/' + botId + '/config', {
        method: 'PATCH',
        data: { section: section, data: data },
      }).then(
        function (res) {
          setState('saved');
          window.setTimeout(function () { setState('idle'); }, 2500);
          return res;
        },
        function (err) {
          setState('error');
          throw err;
        }
      );
    }, [section, botId]);
    return { state: state, save: save };
  }

  function SaveButton(props) {
    return el(
      'div',
      { className: 'pa-saverow' },
      props.helpUrl
        ? el('a', {
            className: 'pa-saverow__help',
            href: CFG.appUrl + props.helpUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, __('Need Help?', 'proxyai'))
        : el('span'),
      el('div', { className: 'pa-saverow__right' },
        props.state === 'error'
          ? el('span', { className: 'pa-saverow__err' }, __('Could not save. Try again.', 'proxyai'))
          : null,
        el(Button, { variant: 'primary', busy: props.state === 'saving', onClick: props.onClick },
          props.state === 'saved' ? __('Saved', 'proxyai') : __('Save', 'proxyai')))
    );
  }

  // ------------------------------------------------------------------
  // Checkout (top-up and add-ons)
  // ------------------------------------------------------------------

  var stripeLoader = null;
  function loadStripe() {
    if (!CFG.stripeKey) return Promise.reject(new Error('payments unavailable'));
    if (window.Stripe) return Promise.resolve(window.Stripe(CFG.stripeKey));
    if (!stripeLoader) {
      stripeLoader = new Promise(function (resolve, reject) {
        var tag = document.createElement('script');
        tag.src = 'https://js.stripe.com/basil/stripe.js';
        tag.onload = function () { resolve(window.Stripe(CFG.stripeKey)); };
        tag.onerror = function () { stripeLoader = null; reject(new Error('stripe load failed')); };
        document.head.appendChild(tag);
      });
    }
    return stripeLoader;
  }

  var TOPUP_PRESETS = [10, 20, 50, 100];
  var MIN_USD = 10;
  var MAX_USD = 1000;

  /** The two-button payment picker, mirroring services/PaymentMethodPicker. */
  function PaymentMethodPicker(props) {
    function btn(key, children) {
      var on = props.method === key;
      return el('button', {
        type: 'button',
        className: 'pa-paypick' + (on ? ' is-on' : ''),
        onClick: function () { props.onChange(key); },
      }, children);
    }
    return el('div', { className: 'pa-paypick__grid' },
      btn('stripe', [
        el('svg', { key: 'i', width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: '#635bff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
          el('rect', { width: 20, height: 14, x: 2, y: 5, rx: 2 }),
          el('line', { x1: 2, x2: 22, y1: 10, y2: 10 })),
        ' ' + __('Card (Stripe)', 'proxyai'),
      ]),
      btn('paypal', [
        el('svg', { key: 'i', width: 16, height: 16, viewBox: '0 0 24 24', fill: '#003087', 'aria-hidden': 'true' },
          el('path', { d: 'M7.1 21 8 15.7h-2.6c-.5 0-.8-.4-.7-.9L7.2 3.6c.1-.4.4-.6.8-.6h6.6c2.2 0 3.9.5 4.8 1.5.9.9 1.2 2.2.9 3.9-.5 3.3-2.7 5-6.4 5h-2.1c-.4 0-.7.3-.8.6l-.9 5.9c-.1.4-.4.6-.8.6H7.1Z' })),
        ' PayPal',
      ])
    );
  }

  /** Payment dialog, matching the hosted dashboard's checkout. */
  function CheckoutDialog(props) {
    var intent = props.intent; // {kind:'topup'} | {kind:'addons', productIds, total, label, method}
    var s1 = useState(null); var error = s1[0]; var setError = s1[1];
    var s2 = useState(intent.kind !== 'topup'); var started = s2[0]; var setStarted = s2[1];
    var s3 = useState(20); var preset = s3[0]; var setPreset = s3[1];
    var s4 = useState(''); var custom = s4[0]; var setCustom = s4[1];
    var s5 = useState(intent.kind === 'addons' ? (intent.method || 'stripe') : 'stripe');
    var method = s5[0]; var setMethod = s5[1];
    var s6 = useState(false); var paypalTab = s6[0]; var setPaypalTab = s6[1];
    var s7 = useState(false); var settling = s7[0]; var setSettling = s7[1];
    var s8 = useState(false); var mounted = s8[0]; var setMounted = s8[1];
    var mountRef = useRef(null);
    var checkoutRef = useRef(null);
    var orderIdRef = useRef(null);
    var inFlight = useRef(false);

    var usingCustom = preset === null;
    var amount = usingCustom ? (parseFloat(custom) || 0) : preset;
    var validAmount = amount >= MIN_USD && amount <= MAX_USD;

    // Settle now rather than waiting on the webhook, so the refresh that
    // follows sees the grant. Idempotent with the webhook.
    function onComplete() {
      setSettling(true);
      var orderId = orderIdRef.current;
      var settle = orderId
        ? api('wordpress/checkout/confirm', { method: 'POST', data: { orderId: orderId } }).catch(function () {})
        : Promise.resolve();
      settle.then(function () { props.onPaid(); });
    }

    var begin = useCallback(function (chosenMethod) {
      if (inFlight.current) return;
      inFlight.current = true;
      var body = intent.kind === 'topup'
        ? { amount: amount, paymentMethod: chosenMethod }
        : { productIds: intent.productIds, paymentMethod: chosenMethod };
      api('wordpress/checkout', { method: 'POST', data: body }).then(
        function (res) {
          orderIdRef.current = (res && res.orderId) || null;
          if (res && res.redirectUrl) {
            window.open(res.redirectUrl, '_blank', 'noopener');
            setPaypalTab(true);
            return;
          }
          if (res && res.clientSecret) {
            loadStripe().then(function (stripe) {
              return stripe.initEmbeddedCheckout({
                clientSecret: res.clientSecret,
                onComplete: onComplete,
              });
            }).then(function (checkout) {
              checkoutRef.current = checkout;
              if (mountRef.current) {
                checkout.mount(mountRef.current);
                setMounted(true);
              }
            }).catch(function () {
              // Stripe.js failed to load after the order was created —
              // release the latch so retry is possible.
              inFlight.current = false;
              setError(__('Payments are unavailable right now.', 'proxyai'));
            });
            return;
          }
          inFlight.current = false;
          setError(__('Could not start the payment.', 'proxyai'));
        },
        function (err) {
          inFlight.current = false;
          setError(statusOf(err) === 409 || errorOf(err) === 'already_owned'
            ? __('You already own one of these add-ons.', 'proxyai')
            : __('Could not start checkout. Please try again.', 'proxyai'));
        }
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [intent, amount]);

    useEffect(function () {
      if (started && intent.kind === 'addons') begin(intent.method || 'stripe');
      return function () {
        if (checkoutRef.current) checkoutRef.current.destroy();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function sectionLabel(text) {
      return el('span', { className: 'pa-pay__sectionlabel' }, text);
    }

    var appUrl = CFG.appUrl || '';

    return el(
      'div',
      {
        className: 'pa-pay',
        role: 'dialog', 'aria-modal': 'true',
        'aria-label': intent.kind === 'topup' ? __('Add credit', 'proxyai') : intent.label,
      },
      el(
        'div',
        { className: 'pa-pay__panel' },
        el('div', { className: 'pa-pay__head' },
          el('div', null,
            el('h2', { className: 'pa-pay__title' },
              intent.kind === 'topup' ? __('Add credit', 'proxyai') : intent.label),
            el('p', { className: 'pa-pay__sub' },
              intent.kind === 'addons'
                ? '$' + intent.total + ' — ' + __('one-time', 'proxyai')
                : __('Credit is what your bot spends as it answers.', 'proxyai'))),
          el('button', {
            type: 'button', className: 'pa-pay__close', 'aria-label': __('Close', 'proxyai'),
            onClick: props.onClose,
          }, '×')),

        error ? el('div', { className: 'pa-pay__error' }, error) : null,

        !started && intent.kind === 'topup' && !paypalTab
          ? el(
              'div',
              { className: 'pa-pay__body' },
              el('div', { className: 'pa-pay__section' },
                sectionLabel(__('SELECT AMOUNT', 'proxyai')),
                el('div', { className: 'pa-pay__presets' },
                  TOPUP_PRESETS.map(function (v) {
                    return el('button', {
                      key: v, type: 'button',
                      className: 'pa-pay__preset' + (preset === v ? ' is-on' : ''),
                      onClick: function () { setPreset(v); setCustom(''); },
                    }, '$' + v);
                  }))),
              el('div', { className: 'pa-pay__section' },
                sectionLabel(__('OR ENTER CUSTOM AMOUNT', 'proxyai')),
                el('div', { className: 'pa-pay__custom' + (usingCustom ? ' is-on' : '') },
                  el('span', { className: 'pa-pay__dollar' }, '$'),
                  el('input', {
                    value: custom,
                    inputMode: 'decimal',
                    placeholder: '0.00',
                    'aria-label': __('Custom amount', 'proxyai'),
                    onFocus: function () { setPreset(null); },
                    onChange: function (e) {
                      setCustom(e.target.value.replace(/[^0-9.]/g, ''));
                      setPreset(null);
                    },
                  })),
                el('span', { className: 'pa-pay__caption' },
                  __('Minimum', 'proxyai') + ' $' + MIN_USD + ' · ' + __('maximum', 'proxyai') + ' $' + MAX_USD.toLocaleString() + ' ' + __('per top-up', 'proxyai'))),
              el('div', { className: 'pa-pay__summary' },
                el('div', { className: 'pa-pay__sumrow' },
                  el('span', null, __('Top-up amount', 'proxyai')),
                  el('span', { className: 'pa-pay__sumvalue' }, validAmount ? '$' + amount.toFixed(2) : '—')),
                el('div', { className: 'pa-pay__sumrow' },
                  el('span', null, __('New balance after top-up', 'proxyai')),
                  el('span', { className: 'pa-pay__sumtotal' },
                    '$' + (Number(props.balance || 0) + (validAmount ? amount : 0)).toFixed(2)))),
              el('div', { className: 'pa-pay__section' },
                sectionLabel(__('PAY WITH', 'proxyai')),
                el(PaymentMethodPicker, { method: method, onChange: setMethod })),
              el('button', {
                type: 'button',
                className: 'pa-pay__continue' + (validAmount ? '' : ' is-disabled'),
                disabled: !validAmount,
                onClick: function () { setStarted(true); begin(method); },
              },
                validAmount
                  ? __('Continue to', 'proxyai') + ' ' + (method === 'stripe' ? 'Stripe' : 'PayPal') + ' — $' + amount.toFixed(2) + ' →'
                  : __('Enter an amount', 'proxyai') + ' ($' + MIN_USD + '–$' + MAX_USD.toLocaleString() + ')'),
              el('div', { className: 'pa-pay__secure' },
                '🔒 ' + (method === 'stripe'
                  ? __('Secure checkout — your card is handled by Stripe', 'proxyai')
                  : __('Secure checkout — PayPal opens in a new tab', 'proxyai'))),
              el('div', { className: 'pa-pay__terms' },
                __('By top-up, you agree to our', 'proxyai') + ' ',
                el('a', { href: appUrl + '/terms', target: '_blank', rel: 'noopener noreferrer' }, __('Terms of Service', 'proxyai')),
                ' ' + __('and', 'proxyai') + ' ',
                el('a', { href: appUrl + '/service-agreement', target: '_blank', rel: 'noopener noreferrer' }, __('Service Agreement', 'proxyai')),
                '.'))
          : null,

        paypalTab
          ? el('div', { className: 'pa-pay__wait' },
              el('p', { className: 'pa-pay__waittitle' }, __('Finish paying in the PayPal tab', 'proxyai')),
              el('p', { className: 'pa-pay__waitsub' },
                __('PayPal opened in a new tab. Approve the payment there — this dashboard updates as soon as you come back.', 'proxyai')),
              el(Button, { onClick: props.onClose }, __('Close', 'proxyai')))
          : null,

        settling
          ? el('div', { className: 'pa-pay__wait' },
              el(Spinner, null),
              el('p', { className: 'pa-pay__waittitle' }, __('Payment received', 'proxyai')),
              el('p', { className: 'pa-pay__waitsub' },
                __('Activating', 'proxyai') + ' ' + (intent.kind === 'topup' ? __('your credit', 'proxyai') : intent.label) + '…'))
          : null,

        !paypalTab && started
          ? el('div', {
              className: 'pa-pay__stripe' + (settling ? ' is-hidden' : ''),
              ref: mountRef,
            }, mounted || error ? null : el(Spinner, null))
          : null
      )
    );
  }

  /** Launch-pricing pill shown beside "Add-ons" headings. */
  function LaunchTag() {
    return el('span', { className: 'pa-launchtag' }, __('Offers limited to first 100 customers', 'proxyai'));
  }

  /**
   * Spend panel above the tabs: bars left, donut right. Mirrors
   * the hosted dashboard's; renders nothing until it has data.
   */
  var DONUT_COLORS = ['#22c55e', '#5fdf8e', '#dccf60', '#84e4a8', '#64748b'];

  function spendFmt(v) {
    if (v === 0) return '$0.00';
    return v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2);
  }

  function SpendPanel() {
    var s1 = useState(null); var data = s1[0]; var setData = s1[1];
    useEffect(function () {
      var cancelled = false;
      api('wordpress/analytics').then(function (res) {
        if (!cancelled && res && res.days) setData(res);
      }, function () {});
      return function () { cancelled = true; };
    }, []);
    if (!data) return null;

    var peak = 0;
    data.days.forEach(function (d) { if (d.cost > peak) peak = d.cost; });
    var totalCost = data.total;
    var offset = 0;
    var slices = data.categories.map(function (c, i) {
      var pct = totalCost > 0 ? (c.cost / totalCost) * 100 : 0;
      var slice = {
        label: c.label, pct: pct,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
        dashoffset: 25 - offset,
      };
      offset += pct;
      return slice;
    });

    return el(
      'div',
      { className: 'pa-spend' },
      el(
        'div',
        { className: 'pa-spend__card' },
        el('div', { className: 'pa-spend__head' },
          el('h2', { className: 'pa-spend__title' }, __('SPEND — LAST', 'proxyai') + ' ' + data.windowDays + ' ' + __('DAYS', 'proxyai')),
          el('span', { className: 'pa-spend__sub' }, __('per day', 'proxyai'))),
        el('div', { className: 'pa-spend__bars' },
          data.days.map(function (d, i) {
            return el('div', {
              key: d.day,
              title: d.label + ': ' + spendFmt(d.cost),
              className: 'pa-spend__bar',
              style: {
                height: peak > 0 ? Math.max(3, Math.round((d.cost / peak) * 100)) + '%' : '3%',
                background: i === data.days.length - 1 ? '#22c55e' : '#a7f3c4',
              },
            });
          })),
        el('div', { className: 'pa-spend__axis' },
          el('span', null, data.days[0] && data.days[0].label),
          el('span', null, data.days[Math.floor(data.days.length / 2)] && data.days[Math.floor(data.days.length / 2)].label),
          el('span', null, data.days[data.days.length - 1] && data.days[data.days.length - 1].label))
      ),
      el(
        'div',
        { className: 'pa-spend__card' },
        el('h2', { className: 'pa-spend__title' }, __('SPEND BY CATEGORY', 'proxyai')),
        slices.length === 0 || totalCost === 0
          ? el('p', { className: 'pa-spend__empty' }, __('No usage yet.', 'proxyai'))
          : el('div', { className: 'pa-spend__donutrow' },
              el('svg', { width: 110, height: 110, viewBox: '0 0 42 42', role: 'img', 'aria-label': __('Spend by category', 'proxyai') },
                [el('circle', { key: 'bg', cx: 21, cy: 21, r: 15.9, fill: 'none', stroke: '#f3f4ec', strokeWidth: 6 })]
                  .concat(slices.map(function (a) {
                    return el('circle', {
                      key: a.label, cx: 21, cy: 21, r: 15.9, fill: 'none',
                      stroke: a.color, strokeWidth: 6,
                      strokeDasharray: a.pct + ' ' + (100 - a.pct),
                      strokeDashoffset: a.dashoffset,
                    });
                  }))
                  .concat([
                    el('text', { key: 't1', x: 21, y: 20, textAnchor: 'middle', style: { fontSize: '5px', fontWeight: 700, fill: '#16a34a' } }, spendFmt(totalCost)),
                    el('text', { key: 't2', x: 21, y: 27, textAnchor: 'middle', style: { fontSize: '3.6px', fill: '#a7afa2' } }, data.windowDays + ' ' + __('days', 'proxyai')),
                  ])),
              el('div', { className: 'pa-spend__legend' },
                slices.map(function (s) {
                  return el('span', { key: s.label, className: 'pa-spend__legendrow' },
                    el('span', { className: 'pa-spend__swatch', style: { background: s.color } }),
                    s.label + ' · ' + Math.round(s.pct) + '%');
                })))
      )
    );
  }

  /**
   * Agent photo and editable name in the header — shown to visitors after a
   * handoff. Mirrors the hosted dashboard.
   */
  function AgentAvatar(props) {
    var s1 = useState(props.initialUrl); var url = s1[0]; var setUrl = s1[1];
    var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
    var s3 = useState(''); var error = s3[0]; var setError = s3[1];
    var s4 = useState(false); var editing = s4[0]; var setEditing = s4[1];
    var s5 = useState(props.name); var draft = s5[0]; var setDraft = s5[1];
    var s6 = useState(props.name); var name = s6[0]; var setName = s6[1];
    var fileRef = useRef(null);

    function saveName() {
      var trimmed = draft.trim();
      setEditing(false);
      if (!trimmed || trimmed === name) { setDraft(name); return; }
      api('wordpress/settings', { method: 'PATCH', data: { agentName: trimmed } }).then(
        function () { setName(trimmed); },
        function () { setDraft(name); setError(__('Could not save the name.', 'proxyai')); }
      );
    }

    function choose(file) {
      setError('');
      if (file.size > 2 * 1024 * 1024) {
        setError(__('Image must be 2 MB or smaller.', 'proxyai'));
        return;
      }
      setBusy(true);
      var body = new window.FormData();
      body.append('file', file);
      // apiFetch would JSON-encode; multipart goes through fetch with the
      // REST nonce attached by hand.
      window.fetch(CFG.restUrl + 'proxyai/v1/admin/account/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': CFG.restNonce },
        body: body,
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data && data.url) setUrl(data.url);
        else setError(data && data.error === 'unsupported_type'
          ? __('Use a PNG, JPG, or WebP image.', 'proxyai')
          : __('Upload failed.', 'proxyai'));
      }).catch(function () { setError(__('Upload failed.', 'proxyai')); })
        .then(function () { setBusy(false); });
    }

    function remove() {
      setBusy(true);
      setError('');
      api('account/avatar', { method: 'DELETE' }).then(
        function () { setUrl(null); },
        function () { setError(__('Could not remove the photo.', 'proxyai')); }
      ).then(function () { setBusy(false); });
    }

    return el(
      'div',
      { className: 'pa-agent' },
      el('div', { className: 'pa-agent__meta' },
        editing
          ? el('input', {
              autoFocus: true,
              className: 'pa-agent__nameinput',
              value: draft,
              onChange: function (e) { setDraft(e.target.value); },
              onBlur: saveName,
              onKeyDown: function (e) {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setDraft(name); setEditing(false); }
              },
            })
          : el('button', {
              type: 'button', className: 'pa-agent__name',
              onClick: function () { setEditing(true); },
            }, name || __('Agent', 'proxyai')),
        el('span', { className: 'pa-agent__hint' },
          url ? __('Photo shown to customers', 'proxyai') : __('Add a photo', 'proxyai')),
        error ? el('span', { className: 'pa-agent__error' }, error) : null),
      el('input', {
        type: 'file', accept: 'image/png,image/jpeg,image/webp',
        style: { display: 'none' }, ref: fileRef,
        onChange: function (e) { if (e.target.files && e.target.files[0]) choose(e.target.files[0]); },
      }),
      el('button', {
        type: 'button',
        className: 'pa-agent__photo',
        disabled: busy,
        title: url ? __('Change your photo', 'proxyai') : __('Add your photo', 'proxyai'),
        onClick: function () { fileRef.current && fileRef.current.click(); },
      }, url
        ? el('img', { src: url, alt: '' })
        : el('span', { className: 'pa-agent__fallback', 'aria-hidden': 'true' }, '👤')),
      url
        ? el('button', {
            type: 'button', className: 'pa-link', disabled: busy,
            onClick: remove,
          }, __('Remove', 'proxyai'))
        : null
    );
  }

  // ------------------------------------------------------------------
  // Add-ons tab
  // ------------------------------------------------------------------

  /**
   * Catalogue icons matching the hosted dashboard — Lucide
   * glyphs (ISC licensed), inlined; the plugin ships no icon library.
   */
  var ICON_PATHS = {
    bot: ['M12 8V4H8', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'],
    rag: [
      'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z',
      'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
    ],
    shield: [
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.5 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    ],
    handoff: [
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
      'M22 21v-2a4 4 0 0 0-3-3.87',
      'M16 3.13a4 4 0 0 1 0 7.75',
    ],
    'default': [
      'm7.5 4.27 9 5.15',
      'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
      'm3.3 7 8.7 5 8.7-5',
      'M12 22V12',
    ],
  };

  function ProductIcon(props) {
    var paths = ICON_PATHS[props.icon] || ICON_PATHS['default'];
    var children = paths.map(function (d, i) {
      return el('path', { key: i, d: d });
    });
    if (props.icon === 'bot') {
      children.push(el('rect', { key: 'r', width: 16, height: 12, x: 4, y: 8, rx: 2 }));
    }
    if (props.icon === 'handoff') {
      children.push(el('circle', { key: 'c', cx: 9, cy: 7, r: 4 }));
    }
    return el('svg', {
      width: 15, height: 15, viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', strokeWidth: 2,
      strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true',
    }, children);
  }

  /** Add-on rows and pay bar; each surface supplies its own card. */
  function AddonList(props) {
    var state = props.state;
    var owned = {};
    props.ownedAddonIds.forEach(function (id) { owned[id] = true; });
    var s1 = useState({}); var selected = s1[0]; var setSelected = s1[1];
    var s2 = useState(null); var busyBadge = s2[0]; var setBusyBadge = s2[1];
    var s3 = useState(null); var error = s3[0]; var setError = s3[1];

    var selectable = state.catalog.filter(function (a) { return !owned[a.id]; });
    var chosen = selectable.filter(function (a) { return selected[a.id]; });
    var total = chosen.reduce(function (sum, a) { return sum + Number(a.price); }, 0);

    function takeBadge(addon) {
      setBusyBadge(addon.id);
      setError(null);
      api('wordpress/checkout', {
        method: 'POST',
        data: { productIds: [addon.id], badge: true },
      }).then(
        function () { return props.onRefresh(); },
        function (err) {
          setError(statusOf(err) === 409 || errorOf(err) === 'already_owned'
            ? __('Already active on this bot.', 'proxyai')
            : __('Could not add the add-on. Try again.', 'proxyai'));
        }
      ).then(function () { setBusyBadge(null); });
    }

    return el(
      Fragment,
      null,
      error ? el(Notice, { kind: 'error' }, error) : null,
      el(
        'div',
        { className: 'pa-addons' },
        state.catalog.map(function (addon) {
          var isOwned = !!owned[addon.id];
          var isSelected = !!selected[addon.id];
          return el(
            'div',
            { key: addon.id, className: 'pa-addon' },
            el(
              'div',
              { className: 'pa-addon__info' },
              el('span', { className: 'pa-addon__namerow' },
                el('span', { className: 'pa-addon__icon' }, el(ProductIcon, { icon: addon.icon })),
                el('span', { className: 'pa-addon__name' }, addon.name)),
              addon.description ? el('p', { className: 'pa-addon__desc' }, addon.description) : null,
              addon.bullets && addon.bullets.length
                ? el('ul', { className: 'pa-addon__bullets' }, addon.bullets.map(function (b) {
                    return el('li', { key: b }, b);
                  }))
                : null
            ),
            isOwned
              ? el('span', { className: 'pa-addon__owned' }, '✓ ' + __('Active', 'proxyai'))
              : el(
                  'div',
                  { className: 'pa-addon__buy' },
                  el('button', {
                    type: 'button',
                    role: 'checkbox',
                    'aria-checked': isSelected ? 'true' : 'false',
                    className: 'pa-chip pa-chip--price' + (isSelected ? ' is-active' : ''),
                    onClick: function () {
                      var next = {};
                      Object.keys(selected).forEach(function (k) { next[k] = selected[k]; });
                      next[addon.id] = !next[addon.id];
                      setSelected(next);
                    },
                  }, (isSelected ? '✓ ' : '') + '$' + Number(addon.price).toFixed(2)),
                  Number(addon.creditsIncluded || 0) > 0
                    ? el('span', { className: 'pa-addon__note' },
                        '$' + Number(addon.creditsIncluded).toFixed(2) + ' ' + __('credits included', 'proxyai'))
                    : null,
                  addon.usualPrice
                    ? el('span', { className: 'pa-addon__usual' }, __('usual', 'proxyai') + ' $' + Number(addon.usualPrice).toFixed(2))
                    : null,
                  addon.badgeEligible
                    ? el(
                        Fragment,
                        null,
                        el('span', { className: 'pa-addon__rule', 'aria-hidden': 'true' }),
                        el(Button, {
                          busy: busyBadge === addon.id,
                          title: __('Free instead of paying. The feature works identically', 'proxyai') +
                            (addon.badgeCreditIncluded
                              ? __(', credit included', 'proxyai')
                              : __(' — only the paid option includes starting credit', 'proxyai')) +
                            __('; the bottom of your chat widget shows a small “Powered by ProxyAI” line. Off unless you choose it here — the paid button above is the same add-on without it.', 'proxyai'),
                          onClick: function () { takeBadge(addon); },
                        },
                          __('Add free — with badge', 'proxyai'),
                          addon.badgeCreditIncluded && Number(addon.creditsIncluded || 0) > 0
                            ? el('span', { className: 'pa-addon__note' },
                                '$' + Number(addon.creditsIncluded).toFixed(2) + ' ' + __('included', 'proxyai'))
                            : null),
                        el('span', { className: 'pa-addon__badge' }, 'Powered by ProxyAI')
                      )
                    : null
                )
          );
        })
      ),
      chosen.length > 0
        ? el(
            'div',
            { className: 'pa-paybar' },
            el('span', null,
              chosen.length === 1
                ? __('1 add-on selected · one payment', 'proxyai')
                : chosen.length + ' ' + __('add-ons selected · one payment', 'proxyai')),
            el('span', { className: 'pa-paybar__actions' },
              el('strong', null, '$' + total.toFixed(2)),
              el(Button, {
                variant: 'primary',
                onClick: function () {
                  props.onBuy({
                    kind: 'addons',
                    productIds: chosen.map(function (a) { return a.id; }),
                    label: chosen.length === 1 ? chosen[0].name : chosen.length + ' add-ons',
                    method: 'stripe',
                  });
                },
              }, __('Pay with card', 'proxyai')),
              CFG.paypal ? el(Button, {
                variant: 'paypal',
                onClick: function () {
                  props.onBuy({
                    kind: 'addons',
                    productIds: chosen.map(function (a) { return a.id; }),
                    label: chosen.length === 1 ? chosen[0].name : chosen.length + ' add-ons',
                    method: 'paypal',
                  });
                },
              }, 'PayPal') : null)
          )
        : null
    );
  }

  /** The Add-ons & credits tab: the shared list inside its own card. */
  function AddonsTab(props) {
    return el(
      Card,
      null,
      el('div', { className: 'pa-titlerow' },
        el('h2', { className: 'pa-card__title' }, __('Add-ons & credits', 'proxyai')),
        el(LaunchTag, null)),
      el('p', { className: 'pa-card__sub' },
        __('Pay here — your card is handled by Stripe and never touches your site.', 'proxyai')),
      el(AddonList, props)
    );
  }

  // ------------------------------------------------------------------
  // Config tab — the embedded app's sub-tabs, gated on owned add-ons as
  // the hosted dashboard gates them.
  // ------------------------------------------------------------------

  var LANGUAGE_OPTIONS = [
    { value: 'auto', label: __('Auto — match the customer', 'proxyai') },
    { value: 'en', label: 'English' },
    { value: 'ms', label: 'Bahasa Melayu' },
    { value: 'id', label: 'Bahasa Indonesia' },
    { value: 'zh', label: 'Chinese (Simplified)' },
    { value: 'zh-TW', label: 'Chinese (Traditional)' },
    { value: 'ta', label: 'Tamil' },
    { value: 'th', label: 'Thai' },
    { value: 'vi', label: 'Vietnamese' },
    { value: 'ja', label: 'Japanese' },
    { value: 'ko', label: 'Korean' },
    { value: 'es', label: 'Spanish' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'ar', label: 'Arabic' },
    { value: 'hi', label: 'Hindi' },
  ];

  var UNLIMITED_RESPONSES = 205;

  /** Bundled brand mark for a channel card or modal, from assets/icons/. */
  function ChannelIcon(props) {
    return el('img', {
      src: (CFG.assetsUrl || '') + 'icons/channel-' + props.name + '.svg',
      alt: '', width: props.size || 26, height: props.size || 26,
      'aria-hidden': 'true',
    });
  }

  /**
   * Config sub-tab glyphs, ported from the hosted dashboard.
   * Shown instead of the labels on narrow screens.
   */
  function tabIcon(key) {
    var attrs = {
      xmlns: 'http://www.w3.org/2000/svg', width: 20, height: 20,
      viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false',
    };
    switch (key) {
      case 'identity':
        return el('svg', attrs, el('g', { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
          el('path', { strokeLinejoin: 'round', d: 'M14 3.5h-4c-3.771 0-5.657 0-6.828 1.172S2 7.729 2 11.5v1c0 3.771 0 5.657 1.172 6.828S6.229 20.5 10 20.5h4c3.771 0 5.657 0 6.828-1.172S22 16.271 22 12.5v-1c0-3.771 0-5.657-1.172-6.828S17.771 3.5 14 3.5Z' }),
          el('path', { strokeLinecap: 'round', d: 'M5 16c1.036-2.581 4.896-2.75 6 0' }),
          el('path', { d: 'M9.75 9.75a1.75 1.75 0 1 1-3.5 0a1.75 1.75 0 0 1 3.5 0Z' }),
          el('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M14 8.5h5M14 12h5m-5 3.5h2.5' })));
      case 'knowledge':
        return el('svg', attrs, el('g', { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2 },
          el('path', { d: 'M12 18V5m3 8a4.17 4.17 0 0 1-3-4a4.17 4.17 0 0 1-3 4m8.598-6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5' }),
          el('path', { d: 'M17.997 5.125a4 4 0 0 1 2.526 5.77' }),
          el('path', { d: 'M18 18a4 4 0 0 0 2-7.464' }),
          el('path', { d: 'M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517' }),
          el('path', { d: 'M6 18a4 4 0 0 1-2-7.464' }),
          el('path', { d: 'M6.003 5.125a4 4 0 0 0-2.526 5.77' })));
      case 'abuseGuard':
        return el('svg', attrs, el('path', { fill: 'currentColor', d: 'm12 1l8.217 1.826a1 1 0 0 1 .783.976v9.987a6 6 0 0 1-2.672 4.992L12 23l-6.328-4.219A6 6 0 0 1 3 13.79V3.802a1 1 0 0 1 .783-.976zm0 2.049L5 4.604v9.185a4 4 0 0 0 1.781 3.328L12 20.597l5.219-3.48A4 4 0 0 0 19 13.79V4.604zm4.452 5.173l1.415 1.414L11.503 16L7.26 11.757l1.414-1.414l2.828 2.828z' }));
      case 'handoff':
        return el('svg', attrs, el('path', { fill: 'currentColor', d: 'M16 3.23Q17.065 2 18.7 2c.91 0 1.67.33 2.3 1s.96 1.43 1 2.3c0 .7-.33 1.51-1 2.46s-1.32 1.74-1.97 2.39q-.975.96-3.03 2.85q-2.085-1.89-3.06-2.85c-.975-.96-1.31-1.44-1.97-2.39S10 6 10 5.3c0-.91.32-1.67.97-2.3s1.43-.96 2.34-1c1.07 0 1.96.41 2.69 1.23M22 19v1l-8 2.5l-7-1.94V22H1V11h7.97l6.16 2.3A2.89 2.89 0 0 1 17 16h2c1.66 0 3 1.34 3 3M5 20v-7H3v7zm14.9-1.43c-.16-.33-.51-.57-.9-.57h-5.35c-.54 0-1.07-.08-1.58-.25l-2.38-.79l.63-1.9l2.38.79c.3.1 2.3.15 2.3.15c0-.37-.23-.7-.57-.83L8.61 13H7v5.5l6.97 1.91z' }));
      case 'helpdesk':
        return el('svg', attrs,
          el('path', { fill: 'currentColor', d: 'M21 12.22C21 6.73 16.74 3 12 3c-4.69 0-9 3.65-9 9.28c-.6.34-1 .98-1 1.72v2c0 1.1.9 2 2 2h1v-6.1c0-3.87 3.13-7 7-7s7 3.13 7 7V19h-8v2h8c1.1 0 2-.9 2-2v-1.22c.59-.31 1-.92 1-1.64v-2.3c0-.7-.41-1.31-1-1.62' }),
          el('circle', { cx: 9, cy: 13, r: 1, fill: 'currentColor' }),
          el('circle', { cx: 15, cy: 13, r: 1, fill: 'currentColor' }),
          el('path', { fill: 'currentColor', d: 'M18 11.03A6.04 6.04 0 0 0 12.05 6c-3.03 0-6.29 2.51-6.03 6.45a8.07 8.07 0 0 0 4.86-5.89c1.31 2.63 4 4.44 7.12 4.47' }));
      case 'channels':
        return el('svg', attrs, el('path', { fill: 'currentColor', d: 'M18 7h1v1a1 1 0 0 0 2 0V7h1a1 1 0 0 0 0-2h-1V4a1 1 0 0 0-2 0v1h-1a1 1 0 0 0 0 2m2 9a3 3 0 0 0-1.73.56l-2.45-1.45A3.7 3.7 0 0 0 16 14a4 4 0 0 0-3-3.86V7.82a3 3 0 1 0-2 0v2.32A4 4 0 0 0 8 14a3.7 3.7 0 0 0 .18 1.11l-2.45 1.45A3 3 0 0 0 4 16a3 3 0 1 0 3 3a3 3 0 0 0-.12-.8l2.3-1.37a4 4 0 0 0 5.64 0l2.3 1.37A3 3 0 1 0 20 16M4 20a1 1 0 1 1 1-1a1 1 0 0 1-1 1m8-16a1 1 0 1 1-1 1a1 1 0 0 1 1-1m0 12a2 2 0 1 1 2-2a2 2 0 0 1-2 2m8 4a1 1 0 1 1 1-1a1 1 0 0 1-1 1' }));
      case 'extra':
        return el('svg', attrs, el('path', { fill: 'currentColor', d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2m7.46 7.12l-2.78 1.15a4.98 4.98 0 0 0-2.95-2.94l1.15-2.78c2.1.8 3.77 2.47 4.58 4.57M12 15c-1.66 0-3-1.34-3-3s1.34-3 3-3s3 1.34 3 3s-1.34 3-3 3M9.13 4.54l1.17 2.78a5 5 0 0 0-2.98 2.97L4.54 9.13a7.98 7.98 0 0 1 4.59-4.59M4.54 14.87l2.78-1.15a4.97 4.97 0 0 0 2.97 2.96l-1.17 2.78a8 8 0 0 1-4.58-4.59m10.34 4.59l-1.15-2.78a4.98 4.98 0 0 0 2.95-2.97l2.78 1.17a8 8 0 0 1-4.58 4.58' }));
      default:
        return null;
    }
  }

  /** Two fields side by side, stacking on narrow screens. */
  function FieldRow(props) {
    return el('div', { className: 'pa-fieldrow' }, props.children);
  }

  function ToggleRow(props) {
    return el('div', { className: 'pa-switchrow' },
      el('span', { className: 'pa-switchrow__text' },
        el('span', { className: 'pa-switchrow__label' }, props.label),
        props.description ? el('span', { className: 'pa-switchrow__sub' }, props.description) : null),
      el(Toggle, { checked: props.checked, disabled: props.disabled, onChange: props.onChange, label: props.label }));
  }

  function SliderRow(props) {
    return el('div', { className: 'pa-sliderrow' },
      el('span', { className: 'pa-sliderrow__head' },
        el('span', { className: 'pa-switchrow__label' }, props.label),
        el('strong', { className: 'pa-sliderrow__value' }, props.format(props.value))),
      props.hint ? el('span', { className: 'pa-field__hint' }, props.hint) : null,
      el('input', {
        type: 'range', className: 'pa-range',
        min: props.min, max: props.max, step: props.step || 1,
        value: props.value, disabled: props.disabled,
        onChange: function (e) { props.onChange(Number(e.target.value)); },
      }));
  }

  function IdentityPane(props) {
    var fp = props.formProps;
    var s1 = useState(fp.initialIdentity || {}); var identity = s1[0]; var setIdentity = s1[1];
    var saver = useSave('identity', props.botId);
    function set(key, value) {
      var next = {};
      Object.keys(identity).forEach(function (k) { next[k] = identity[k]; });
      next[key] = value;
      setIdentity(next);
    }
    var modelGroups = fp.modelGroups || [];
    function modelOptions(withNone) {
      var options = withNone ? [{ value: '__none__', label: __('None (no fallback)', 'proxyai') }] : [];
      modelGroups.forEach(function (g) {
        g.options.forEach(function (o) {
          options.push({ value: o.value, label: (g.label ? g.label + ' · ' : '') + o.label });
        });
      });
      return options;
    }

    return el(
      Fragment,
      null,
      el('p', { className: 'pa-pane__lede' }, __('Core personality and knowledge shared across every channel.', 'proxyai')),
      el(FieldRow, null,
        el(Field, { label: __('Bot Name', 'proxyai') },
          el(TextInput, { value: identity.name || '', onChange: function (v) { set('name', v); } })),
        el(Field, {
          label: __('Reply Language', 'proxyai'),
          hint: __('Auto follows whichever language the customer writes in. Choosing one pins every reply to it.', 'proxyai'),
        },
          el(SelectInput, {
            value: identity.language || 'auto',
            onChange: function (v) { set('language', v); },
            options: LANGUAGE_OPTIONS,
          }))),
      el(FieldRow, null,
        el(Field, {
          label: __('Model Selection', 'proxyai'),
          labelAction: props.onNavigate
            ? el('button', {
                type: 'button', className: 'pa-link',
                onClick: function () { props.onNavigate('rates'); },
              }, __('Rates', 'proxyai'))
            : null,
        },
          el(SelectInput, {
            value: identity.model || '',
            onChange: function (v) { set('model', v); },
            options: modelOptions(false),
          })),
        el(Field, {
          label: __('Fallback Model', 'proxyai'),
          hint: __('Used only if the primary model fails. Leave as None for no fallback.', 'proxyai'),
        },
          el(SelectInput, {
            value: identity.secondaryModel || '__none__',
            onChange: function (v) { set('secondaryModel', v === '__none__' ? null : v); },
            options: modelOptions(true),
          }))),
      el(Field, { label: __('Bot Intro', 'proxyai') },
        el(TextArea, {
          value: identity.intro || '', rows: 3,
          placeholder: __('How the bot greets a new visitor', 'proxyai'),
          onChange: function (v) { set('intro', v); },
        })),
      el(ToggleRow, {
        label: __('Allow emoji', 'proxyai'),
        description: __('Let the bot use emoji naturally in its replies.', 'proxyai'),
        checked: identity.allowEmoji !== false,
        onChange: function (v) { set('allowEmoji', v); },
      }),
      el(SliderRow, {
        label: __('AI response limit per session', 'proxyai'),
        hint: __('Caps how many times the bot replies in one conversation. Slide to the far right for unlimited.', 'proxyai'),
        min: 10, max: UNLIMITED_RESPONSES, step: 5,
        value: identity.responseLimit == null ? UNLIMITED_RESPONSES : identity.responseLimit,
        format: function (v) {
          return v >= UNLIMITED_RESPONSES ? __('Unlimited', 'proxyai') : v + ' ' + __('responses', 'proxyai');
        },
        onChange: function (v) { set('responseLimit', v >= UNLIMITED_RESPONSES ? null : v); },
      }),
      el(Field, { label: __('Company profile and bot’s purposes', 'proxyai') },
        el(TextArea, {
          value: identity.companyProfile || '', rows: 6,
          placeholder: __('What the company does, and what this bot should help with', 'proxyai'),
          onChange: function (v) { set('companyProfile', v); },
        })),
      el(SaveButton, { state: saver.state, helpUrl: '/help/getting-started/chatbot-configuration', onClick: function () { saver.save(identity); } })
    );
  }

  // --- Bot Knowledge -----------------------------------------------------
  // Text extracts in the browser; drafts, credit check and manifest commits
  // run server-side in PHP (the R2 bucket's CORS cannot name a wp-admin
  // origin). Jobs are queue-owned: they survive the page closing.

  var TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm', 'xml'];
  var RAG_MAX_FILE_BYTES = 50 * 1024 * 1024;
  var RAG_MAX_TEXT_CHARS = 4 * 1024 * 1024;

  function formatSize(bytes) {
    return bytes < 1024 ? bytes + ' B' : Math.round(bytes / 1024) + ' KB';
  }

  function ProgressBar(props) {
    return el('div', { className: 'pa-progress' },
      el('div', {
        className: 'pa-progress__fill' + (props.pct == null ? ' is-indeterminate' : ''),
        style: props.pct == null ? undefined : { width: Math.round(props.pct * 100) + '%' },
      }));
  }

  var STATUS_CHIP = {
    extracting: { label: __('Extracting', 'proxyai'), cls: 'is-working' },
    ready: { label: __('Ready', 'proxyai'), cls: 'is-ready' },
    failed: { label: __('Failed', 'proxyai'), cls: 'is-failed' },
  };

  function StatusChip(props) {
    var chip = STATUS_CHIP[props.status] || STATUS_CHIP.ready;
    return el('span', { className: 'pa-statuschip ' + chip.cls }, chip.label);
  }

  /** Extracts plain text from a text-first file in the browser. */
  function extractTextFile(file) {
    return new Promise(function (resolve, reject) {
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (TEXT_EXTENSIONS.indexOf(ext) === -1) {
        reject(new Error('unsupported_type'));
        return;
      }
      if (file.size > RAG_MAX_FILE_BYTES) {
        reject(new Error('too_large'));
        return;
      }
      var reader = new window.FileReader();
      reader.onerror = function () { reject(new Error('read_failed')); };
      reader.onload = function () {
        var text = String(reader.result || '');
        if (ext === 'html' || ext === 'htm' || ext === 'xml') {
          var parsed = new window.DOMParser().parseFromString(text, ext === 'xml' ? 'text/xml' : 'text/html');
          text = (parsed.body ? parsed.body.textContent : parsed.documentElement.textContent) || '';
        }
        text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (text.length < 20) { reject(new Error('no_text')); return; }
        if (text.length > RAG_MAX_TEXT_CHARS) { reject(new Error('too_much_text')); return; }
        resolve(text);
      };
      reader.readAsText(file);
    });
  }

  var EXTRACT_ERROR = {
    unsupported_type: __('Text formats only here (.txt, .md, .csv, .html, .json, .xml). For PDF and Office files, use the hosted dashboard — its on-device extractors and OCR need the full app.', 'proxyai'),
    too_large: __('Files are limited to 50MB.', 'proxyai'),
    too_much_text: __('That extracts to more than 4MB of text — the vector store’s per-file limit.', 'proxyai'),
    no_text: __('No readable text found in that file.', 'proxyai'),
    read_failed: __('Could not read the file.', 'proxyai'),
  };

  /** The review dialog: the extracted text, editable before implant. */
  function ReviewModal(props) {
    var s1 = useState(props.doc.markdown); var text = s1[0]; var setText = s1[1];
    return el('div', { className: 'pa-dialog', role: 'dialog', 'aria-modal': 'true' },
      el('div', { className: 'pa-dialog__scrim', onClick: props.onClose }),
      el('div', { className: 'pa-dialog__panel pa-dialog__panel--wide' },
        el('button', {
          type: 'button', className: 'pa-dialog__close', 'aria-label': __('Close', 'proxyai'),
          onClick: props.onClose,
        }, '×'),
        el('h2', { className: 'pa-card__title' }, props.doc.sourceName),
        el('p', { className: 'pa-card__sub' },
          __('This text is what the bot will answer from. Edit it before implanting.', 'proxyai')),
        el('textarea', {
          className: 'pa-input pa-review__area',
          value: text,
          onChange: function (e) { setText(e.target.value); },
        }),
        el('div', { className: 'pa-saverow' },
          el(Button, {
            variant: 'primary',
            onClick: function () { props.onKeep(text); },
          }, __('Keep changes', 'proxyai')),
          el('span', { className: 'pa-field__hint' }, formatSize(text.length)))));
  }

  function KnowledgePane(props) {
    var fp = props.formProps;
    var initRag = fp.initialRag || { documents: [] };
    var s1 = useState(initRag.documents || []); var documents = s1[0]; var setDocuments = s1[1];
    var s2 = useState(initRag.enabled !== false); var searchOn = s2[0]; var setSearchOn = s2[1];
    var s3 = useState([]); var staged = s3[0]; var setStaged = s3[1];
    var s4 = useState([]); var inFlight = s4[0]; var setInFlight = s4[1];
    var s5 = useState(null); var ragError = s5[0]; var setRagError = s5[1];
    var s6 = useState(null); var reviewId = s6[0]; var setReviewId = s6[1];
    var s7 = useState(false); var implanting = s7[0]; var setImplanting = s7[1];
    var s8 = useState(null); var progress = s8[0]; var setProgress = s8[1];
    var s9 = useState(null); var deletingUrl = s9[0]; var setDeletingUrl = s9[1];
    var fileRef = useRef(null);
    var saver = useSave('rag', props.botId);
    var stagedRef = useRef(staged);
    stagedRef.current = staged;

    // Queue-owned jobs recovered from the server; polled while unfinished.
    var loadJobs = useCallback(function () {
      return api('bots/' + props.botId + '/rag/drafts').then(function (res) {
        var jobs = (res && res.jobs) || [];
        setInFlight(jobs.filter(function (j) {
          return j.status === 'queued' || j.status === 'processing' || j.status === 'uploading';
        }).map(function (j) {
          return { jobId: j.jobId, documentName: j.documentName, status: j.status, percentage: j.percentage == null ? null : j.percentage };
        }));
      }, function () {});
    }, [props.botId]);

    useEffect(function () {
      loadJobs();
    }, [loadJobs]);

    useEffect(function () {
      if (inFlight.length === 0) return undefined;
      var timer = window.setInterval(function () {
        Promise.all(inFlight.map(function (job) {
          return api('bots/' + props.botId + '/rag/jobs/' + job.jobId + '?draft=1').then(
            function (res) { return res && res.job ? res.job : res; },
            function () { return null; }
          );
        })).then(function (jobs) {
          var still = [];
          jobs.forEach(function (j, i) {
            if (!j) { still.push(inFlight[i]); return; }
            if (j.status === 'completed') {
              setDocuments(function (docs) {
                var name = j.documentName || inFlight[i].documentName;
                if (docs.some(function (d) { return d.name === name; })) return docs;
                return docs.concat([{
                  name: name,
                  url: 'rag://' + props.botId + '/' + encodeURIComponent(name),
                  size: j.expectedContentBytes || 0,
                  uploadedAt: new Date().toISOString(),
                }]);
              });
              return;
            }
            if (j.status === 'failed') {
              setRagError((j.documentName || '') + ': ' + (j.failureCode || __('indexing failed', 'proxyai')));
              return;
            }
            still.push({
              jobId: inFlight[i].jobId,
              documentName: j.documentName || inFlight[i].documentName,
              status: j.status,
              percentage: j.percentage == null ? null : j.percentage,
            });
          });
          setInFlight(still);
        });
      }, 2500);
      return function () { window.clearInterval(timer); };
    }, [inFlight, props.botId]);

    function stageFiles(files) {
      setRagError(null);
      Array.prototype.forEach.call(files, function (file) {
        var id = file.name + ':' + Date.now() + ':' + Math.floor(performance.now());
        setStaged(function (prev) {
          return prev.concat([{ id: id, sourceName: file.name, status: 'extracting', markdown: '', error: null }]);
        });
        extractTextFile(file).then(
          function (text) {
            setStaged(function (prev) {
              return prev.map(function (d) {
                return d.id === id
                  ? { id: d.id, sourceName: d.sourceName, status: 'ready', markdown: text, error: null }
                  : d;
              });
            });
          },
          function (err) {
            setStaged(function (prev) {
              return prev.map(function (d) {
                return d.id === id
                  ? { id: d.id, sourceName: d.sourceName, status: 'failed', markdown: '',
                      error: EXTRACT_ERROR[err.message] || EXTRACT_ERROR.read_failed }
                  : d;
              });
            });
          }
        );
      });
    }

    function documentNameFor(sourceName) {
      // The ".md" extension tells the vector store's parser the format —
      // a bare name is refused (aisearch_400).
      return sourceName.replace(/\.[^.]+$/, '') + '.md';
    }

    function implantDocs(docs) {
      if (docs.length === 0 || implanting) return;
      setImplanting(true);
      setRagError(null);
      setProgress({ label: docs.length > 1 ? __('Saving', 'proxyai') + ' ' + docs.length + ' ' + __('drafts…', 'proxyai') : __('Saving draft…', 'proxyai'), pct: null });
      apiFetch({
        path: '/proxyai/v1/rag/implant',
        method: 'POST',
        data: {
          documents: docs.map(function (d) {
            return { name: documentNameFor(d.sourceName), markdown: d.markdown };
          }),
        },
      }).then(
        function (res) {
          var ids = {};
          docs.forEach(function (d) { ids[d.id] = true; });
          setStaged(function (prev) {
            return prev.filter(function (d) { return !ids[d.id]; });
          });
          setReviewId(null);
          setInFlight(function (prev) {
            return prev.concat(((res && res.jobs) || []).map(function (j) {
              return { jobId: j.jobId, documentName: j.name, status: 'queued', percentage: null };
            }));
          });
        },
        function (err) {
          var code = (err && err.message) || 'ingest_failed';
          setRagError(code === 'insufficient_credit'
            ? __('Not enough credit to index this batch. Top up and try again.', 'proxyai')
            : __('Implant failed:', 'proxyai') + ' ' + code);
        }
      ).then(function () {
        setImplanting(false);
        setProgress(null);
      });
    }

    function removeDoc(url) {
      setDeletingUrl(url);
      setRagError(null);
      api('bots/' + props.botId + '/upload', { method: 'DELETE', data: { url: url } }).then(
        function (res) {
          if (res && res.rag) {
            setDocuments(res.rag.documents || []);
            setSearchOn(res.rag.enabled !== false);
          } else {
            setDocuments(function (docs) { return docs.filter(function (d) { return d.url !== url; }); });
          }
        },
        function () { setRagError(__('Could not remove document. Try again.', 'proxyai')); }
      ).then(function () { setDeletingUrl(null); });
    }

    var ready = staged.filter(function (d) { return d.status === 'ready'; });
    var reviewDoc = null;
    staged.forEach(function (d) { if (d.id === reviewId) reviewDoc = d; });

    return el(
      Fragment,
      null,
      el('p', { className: 'pa-pane__lede' }, __('Ground answers in your own documents.', 'proxyai')),
      el('div', { className: 'pa-dropzone' },
        el('input', {
          type: 'file', multiple: true, ref: fileRef,
          accept: TEXT_EXTENSIONS.map(function (e) { return '.' + e; }).join(','),
          style: { display: 'none' },
          onChange: function (e) {
            if (e.target.files && e.target.files.length) stageFiles(e.target.files);
            e.target.value = '';
          },
        }),
        el('button', {
          type: 'button', className: 'pa-dropzone__button',
          onClick: function () { fileRef.current && fileRef.current.click(); },
          onDragOver: function (e) { e.preventDefault(); },
          onDrop: function (e) {
            e.preventDefault();
            if (e.dataTransfer && e.dataTransfer.files.length) stageFiles(e.dataTransfer.files);
          },
        },
          el('span', { className: 'pa-switchrow__label' }, __('Knowledge Document Upload', 'proxyai')),
          el('span', { className: 'pa-field__hint' },
            __('Drop files or click to choose. Up to 50MB per file, and 4MB of text once extracted — the vector store’s own per-file limit. You review each document before it is implanted.', 'proxyai')),
          el('span', { className: 'pa-field__hint' },
            __('Text formats natively (.txt, .md, .csv, .html, .json, .xml); PDF and Office files upload from the hosted dashboard.', 'proxyai')))),
      ragError ? el(Notice, { kind: 'error' }, ragError) : null,
      progress
        ? el('div', { className: 'pa-jobrow' },
            el('span', { className: 'pa-field__hint' }, progress.label),
            el(ProgressBar, { pct: progress.pct }))
        : null,
      inFlight.length > 0
        ? el('div', { className: 'pa-jobs' },
            el('span', { className: 'pa-switchrow__label' }, __('Indexing now', 'proxyai')),
            el('span', { className: 'pa-field__hint' },
              __('Running on our servers. Closing this page will not stop it, and this list comes back when you return.', 'proxyai')),
            inFlight.map(function (job) {
              return el('div', { key: job.jobId, className: 'pa-jobrow' },
                el('span', { className: 'pa-jobrow__head' },
                  el('span', { className: 'pa-jobrow__name' }, job.documentName),
                  el('span', { className: 'pa-field__hint' },
                    job.status === 'processing' ? __('Embedding…', 'proxyai') : __('Queued…', 'proxyai'))),
                el(ProgressBar, { pct: job.percentage == null ? null : job.percentage / 100 }));
            }))
        : null,
      staged.length > 0
        ? el('div', { className: 'pa-jobs' },
            el('div', { className: 'pa-jobs__head' },
              el('span', { className: 'pa-switchrow__label' }, __('Staging queue', 'proxyai')),
              el('span', { className: 'pa-jobs__actions' },
                ready.length > 1
                  ? el('button', {
                      type: 'button', className: 'pa-link',
                      disabled: implanting,
                      onClick: function () { implantDocs(ready); },
                    }, __('Implant all', 'proxyai') + ' ' + ready.length)
                  : null,
                el('button', {
                  type: 'button', className: 'pa-link pa-link--muted',
                  disabled: implanting,
                  onClick: function () { setStaged([]); setReviewId(null); },
                }, __('Clear queue', 'proxyai')))),
            el('span', { className: 'pa-field__hint' },
              __('Held in this tab until you implant them — the bot cannot use them yet.', 'proxyai')),
            staged.map(function (d) {
              return el('div', { key: d.id, className: 'pa-jobrow pa-jobrow--staged' },
                el('span', { className: 'pa-jobrow__head' },
                  el('span', { className: 'pa-jobrow__name' }, d.sourceName),
                  el('span', { className: 'pa-jobrow__meta' },
                    d.status === 'failed' ? d.error
                      : d.status === 'extracting' ? __('Extracting…', 'proxyai')
                      : __('Ready', 'proxyai') + ' · ' + formatSize(d.markdown.length))),
                el('span', { className: 'pa-jobrow__actions' },
                  el(StatusChip, { status: d.status }),
                  el(Button, {
                    disabled: d.status !== 'ready',
                    onClick: function () { setReviewId(d.id); },
                  }, __('Review', 'proxyai')),
                  el(Button, {
                    variant: 'primary',
                    disabled: d.status !== 'ready' || implanting,
                    onClick: function () { implantDocs([d]); },
                  }, __('Implant', 'proxyai')),
                  el('button', {
                    type: 'button', className: 'pa-link pa-link--danger',
                    disabled: implanting,
                    onClick: function () {
                      setStaged(function (prev) {
                        return prev.filter(function (x) { return x.id !== d.id; });
                      });
                      if (reviewId === d.id) setReviewId(null);
                    },
                  }, __('Discard', 'proxyai'))));
            }))
        : null,
      el('div', { className: 'pa-namespace' },
        el('div', { className: 'pa-namespace__head' },
          el('span', { className: 'pa-namespace__text' },
            el('span', { className: 'pa-switchrow__label' }, __('Namespace', 'proxyai')),
            el('code', { className: 'pa-namespace__id' }, props.botId)),
          el('span', {
            title: documents.length === 0
              ? __('No documents to search', 'proxyai')
              : searchOn ? __('Searched on every message', 'proxyai') : __('Not searched', 'proxyai'),
          },
            el(Toggle, {
              checked: searchOn && documents.length > 0,
              disabled: documents.length === 0,
              label: __('Search knowledge documents', 'proxyai'),
              onChange: function (enabled) {
                setSearchOn(enabled);
                saver.save({ documents: documents, enabled: enabled });
              },
            }))),
        el('div', { className: 'pa-namespace__docs' },
          el('span', { className: 'pa-switchrow__label' }, __('Implanted documents', 'proxyai')),
          el('span', { className: 'pa-field__hint' }, __('Embedded and searchable by the bot.', 'proxyai')),
          documents.length === 0
            ? el('span', { className: 'pa-namespace__row pa-namespace__row--empty' },
                __('Nothing implanted yet.', 'proxyai'))
            : documents.map(function (d) {
                return el('span', { key: d.url, className: 'pa-namespace__row' },
                  el('span', { className: 'pa-jobrow__name' }, d.name),
                  el('span', { className: 'pa-namespace__rowend' },
                    el('span', { className: 'pa-field__hint' }, formatSize(d.size || 0)),
                    el('button', {
                      type: 'button', className: 'pa-link pa-link--danger',
                      disabled: deletingUrl === d.url,
                      onClick: function () { removeDoc(d.url); },
                    }, deletingUrl === d.url ? __('Removing…', 'proxyai') : __('Remove', 'proxyai'))));
              }))),
      reviewDoc
        ? el(ReviewModal, {
            doc: reviewDoc,
            onClose: function () { setReviewId(null); },
            onKeep: function (text) {
              setStaged(function (prev) {
                return prev.map(function (d) {
                  return d.id === reviewDoc.id
                    ? { id: d.id, sourceName: d.sourceName, status: 'ready', markdown: text, error: null }
                    : d;
                });
              });
              setReviewId(null);
            },
          })
        : null
    );
  }

  function AbusePane(props) {
    var fp = props.formProps;
    var s1 = useState(fp.initialAbuseGuard || {}); var guard = s1[0]; var setGuard = s1[1];
    var saver = useSave('abuseGuard', props.botId);
    function set(key, value) {
      var next = {};
      Object.keys(guard).forEach(function (k) { next[k] = guard[k]; });
      next[key] = value;
      setGuard(next);
    }

    function guardCard(key, label, hint, valueKey) {
      var active = guard.activeGuard === key;
      return el('div', {
        className: 'pa-guardcard' + (active ? ' is-on' : ''),
        role: 'radio', 'aria-checked': active ? 'true' : 'false', tabIndex: 0,
        onClick: function () { set('activeGuard', key); },
      },
        el(SliderRow, {
          label: label, hint: hint,
          min: 1, max: 10, value: guard[valueKey] || 3,
          disabled: !active,
          format: function (v) { return String(v); },
          onChange: function (v) { set(valueKey, v); },
        }));
    }

    return el(
      Fragment,
      null,
      el('p', { className: 'pa-pane__lede' }, __('Dual-layer enforcement against spam and abuse.', 'proxyai')),
      el(ToggleRow, {
        label: __('Intelligent Guard', 'proxyai'),
        description: __('Detects spam, flooding, off-topic replies and abusive behavior.', 'proxyai'),
        checked: !!guard.intelligentGuard,
        onChange: function (v) { set('intelligentGuard', v); },
      }),
      el('div', { className: 'pa-fieldrow', role: 'radiogroup' },
        guardCard('sessionRateLimit', __('Session Rate Limit', 'proxyai'), __('Strikes before a temporary cooldown.', 'proxyai'), 'sessionRateLimit'),
        guardCard('identityBan', __('Identity Ban', 'proxyai'), __('Strikes before a permanent block.', 'proxyai'), 'identityBan')),
      el(Field, {
        label: __('Blocked keywords', 'proxyai'),
        hint: __('One per line. Messages containing these are refused without spending credit.', 'proxyai'),
      },
        el(TextArea, {
          value: (guard.staticKeywords || []).join('\n'), rows: 4,
          onChange: function (v) {
            set('staticKeywords', v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean));
          },
        })),
      el(Field, { label: __('Identity Duration', 'proxyai') },
        el(SelectInput, {
          value: guard.identityDuration || '24h',
          onChange: function (v) { set('identityDuration', v); },
          options: [
            { value: 'permanent', label: __('Permanent', 'proxyai') },
            { value: '1h', label: __('1 hour', 'proxyai') },
            { value: '24h', label: __('24 hours', 'proxyai') },
            { value: '7d', label: __('7 days', 'proxyai') },
          ],
        })),
      el(SaveButton, { state: saver.state, helpUrl: '/help/add-ons/abuse-guard-guide', onClick: function () { saver.save(guard); } })
    );
  }

  var DAY_LABELS = [
    __('Sun', 'proxyai'), __('Mon', 'proxyai'), __('Tue', 'proxyai'), __('Wed', 'proxyai'),
    __('Thu', 'proxyai'), __('Fri', 'proxyai'), __('Sat', 'proxyai'),
  ];

  function HandoffPane(props) {
    var fp = props.formProps;
    var init = fp.initialHandoff || {};
    // Drop a trailing "assistant" so the placeholder sentence doesn't read
    // "...Assistant's automated assistant".
    var storeName = ((fp.initialIdentity && fp.initialIdentity.name) || __('Acme', 'proxyai'))
      .replace(/\s+assistant$/i, '');
    var tz = (window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
    var s1 = useState(init); var handoff = s1[0]; var setHandoff = s1[1];
    var saver = useSave('handoff', props.botId);
    var hours = handoff.workHours || {};
    var wh = {
      enabled: true,
      timezone: hours.timezone || tz,
      start: hours.start || '09:00',
      end: hours.end || '18:00',
      days: hours.days || [1, 2, 3, 4, 5],
    };
    function set(key, value) {
      var next = {};
      Object.keys(handoff).forEach(function (k) { next[k] = handoff[k]; });
      next[key] = value;
      setHandoff(next);
    }
    function setHours(key, value) {
      var next = { enabled: true, timezone: wh.timezone, start: wh.start, end: wh.end, days: wh.days };
      next[key] = value;
      set('workHours', next);
    }

    return el(
      Fragment,
      null,
      el('p', { className: 'pa-pane__lede' }, __('Route conversations to a human agent.', 'proxyai')),
      el(Field, {
        label: __('Footnote shown under AI replies', 'proxyai'),
        hint: __('Shown during hand-off work hours as small text under the reply on web chat; appended to the reply on WhatsApp, LINE and Telegram. Never sent to the LLM. Leave blank for none.', 'proxyai'),
      },
        el(TextArea, {
          value: handoff.appendMessage || '', rows: 4,
          placeholder: sprintf(
            /* translators: %s: the bot's name. */
            __("I'm %s's automated assistant, so I can occasionally get things wrong. If you'd like a teammate to take over at any point, just say so and I'll hand this conversation to a human.", 'proxyai'),
            storeName
          ),
          onChange: function (v) { set('appendMessage', v); },
        })),
      el('div', { className: 'pa-workhours' },
        el('span', { className: 'pa-switchrow__label' }, __('Work hours', 'proxyai')),
        el('span', { className: 'pa-field__hint' },
          __('Hand-off only happens inside these hours — outside them the bot keeps answering.', 'proxyai')),
        el('div', { className: 'pa-workhours__row' },
          el('input', {
            type: 'time', className: 'pa-input pa-workhours__time', value: wh.start,
            onChange: function (e) { setHours('start', e.target.value); },
          }),
          '—',
          el('input', {
            type: 'time', className: 'pa-input pa-workhours__time', value: wh.end,
            onChange: function (e) { setHours('end', e.target.value); },
          }),
          el(SelectInput, {
            className: 'pa-workhours__tz',
            value: wh.timezone,
            onChange: function (v) { setHours('timezone', v); },
            // Full IANA list from the browser; the stored zone stays listed
            // even if unknown here.
            options: (function () {
              var zones;
              try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) {
                zones = ['UTC', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Kolkata', 'Asia/Dubai',
                  'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago',
                  'America/Los_Angeles', 'Australia/Sydney'];
              }
              if (zones.indexOf(wh.timezone) === -1) zones = [wh.timezone].concat(zones);
              return zones.map(function (z) { return { value: z, label: z.replace(/_/g, ' ') }; });
            })(),
          })),
        el('div', { className: 'pa-workhours__days' },
          DAY_LABELS.map(function (label, day) {
            var on = wh.days.indexOf(day) !== -1;
            return el('button', {
              key: label, type: 'button',
              className: 'pa-chip pa-chip--day' + (on ? ' is-active' : ''),
              onClick: function () {
                setHours('days', on
                  ? wh.days.filter(function (d) { return d !== day; })
                  : wh.days.concat([day]).sort());
              },
            }, label);
          }))),
      el('p', { className: 'pa-card__fine' },
        __('Waiting conversations appear in the', 'proxyai') + ' ',
        el('button', {
          type: 'button', className: 'pa-link',
          onClick: function () { props.onNavigate && props.onNavigate('inbox'); },
        }, __('agent inbox', 'proxyai')), '.'),
      el(SaveButton, { state: saver.state, helpUrl: '/help/add-ons/human-handoff-guide', onClick: function () { saver.save(handoff); } })
    );
  }

  // --- Helpdesk: desk connect cards + built-in-desk setup wizard --------
  // Mirrors the embedded form's Helpdesk tab. No tab-level Save — a desk
  // saves when it connects, so the action sits on the card.

  /** Provider brand mark from assets/icons/helpdesk-*.svg. */
  function DeskIcon(props) {
    return el('span', { className: 'pa-deskcard__mark' },
      el('img', {
        src: (CFG.assetsUrl || '') + 'icons/helpdesk-' + props.name + '.svg',
        alt: '', width: 24, height: 24,
      }));
  }

  function ConnPill() {
    return el('span', { className: 'pa-pill pa-pill--ok' }, __('Connected', 'proxyai'));
  }

  /** One line of the connected built-in card's summary. */
  function SetupRow(props) {
    return el('div', { className: 'pa-setuprow', title: props.hint },
      el('span', { className: 'pa-setuprow__label' }, props.label),
      el('span', { className: 'pa-setuprow__value' }, props.value));
  }

  /**
   * SMTP presets ported from HelpdeskSetupWizard, provider quirks included.
   * The merchant's own mailbox sends — an app password, no DNS.
   */
  var MAILBOX_PRESETS = [
    { id: 'gmail', name: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, help: 'https://myaccount.google.com/apppasswords', helpLabel: __('Create a Google app password (needs 2-step verification on)', 'proxyai') },
    { id: 'zoho', name: 'Zoho Mail (paid plan)', host: 'smtp.zoho.com', port: 465, help: 'https://accounts.zoho.com/home#security/security_pwd', helpLabel: __('Create a Zoho app password (needs a paid Zoho plan — free mailboxes have no SMTP; EU/India accounts: pick Other and use smtp.zoho.eu / smtp.zoho.in)', 'proxyai') },
    { id: 'outlook', name: 'Microsoft 365 (sign in)', host: 'smtp.office365.com', port: 587, oauth: 'm365', helpLabel: __('Business Microsoft 365 mailboxes only — personal Outlook/Hotmail accounts have SMTP switched off by Microsoft', 'proxyai') },
    { id: 'ionos', name: 'IONOS', host: 'smtp.ionos.com', port: 465, help: 'https://www.ionos.com/help/email/general-topics/ionos-mail-server-details-for-imap-pop3-and-smtp/', helpLabel: __('Use the mailbox password from your IONOS control panel (UK/Germany accounts: pick Other and use smtp.ionos.co.uk / smtp.ionos.de)', 'proxyai'), passLabel: __('Mailbox password', 'proxyai') },
    { id: 'proton', name: 'Proton Mail (business plans)', host: 'smtp.protonmail.ch', port: 587, help: 'https://proton.me/support/smtp-submission', helpLabel: __('Generate an SMTP token (Settings → IMAP/SMTP; paid Proton for Business plans only)', 'proxyai'), passLabel: __('SMTP token', 'proxyai') },
    { id: 'hostinger', name: 'Hostinger', host: 'smtp.hostinger.com', port: 465, helpLabel: __('Use the email account’s own password (set in hPanel), not your Hostinger login', 'proxyai'), passLabel: __('Mailbox password', 'proxyai') },
    { id: 'dreamhost', name: 'DreamHost', host: 'smtp.dreamhost.com', port: 465, helpLabel: __('Use the mail account’s password from the DreamHost panel', 'proxyai'), passLabel: __('Mailbox password', 'proxyai') },
    { id: 'bluehost', name: 'Bluehost', host: '', port: 465, hostPlaceholder: 'mail.yourdomain.com', helpLabel: __('SMTP host is mail.<your domain> — check Email & Office → your address → Connect Devices; password is the email account’s own', 'proxyai'), passLabel: __('Mailbox password', 'proxyai') },
    { id: 'siteground', name: 'SiteGround', host: '', port: 465, hostPlaceholder: 'mail.yourdomain.com', helpLabel: __('SMTP host is mail.<your domain> (or your server’s name) — shown in Site Tools → Email → Accounts → Mail Configuration; password is the email account’s own', 'proxyai'), passLabel: __('Mailbox password', 'proxyai') },
    { id: 'yahoo', name: 'Yahoo Mail (older accounts only)', host: 'smtp.mail.yahoo.com', port: 465, help: 'https://login.yahoo.com/myaccount/security', helpLabel: __('Create a Yahoo app password (needs 2-step verification; newer Yahoo accounts can’t create one — use Gmail or Zoho instead)', 'proxyai') },
    { id: 'custom', name: __('Other (custom SMTP)', 'proxyai'), host: '', port: 465 },
  ];

  function presetForHost(host) {
    for (var i = 0; i < MAILBOX_PRESETS.length; i++) {
      if (MAILBOX_PRESETS[i].host && MAILBOX_PRESETS[i].host === host) return MAILBOX_PRESETS[i].id;
    }
    return host ? 'custom' : 'gmail';
  }

  var SMTP_ERROR = {
    smtp_basic_auth_disabled: __('Microsoft has switched off password sign-in for this mailbox — no password will ever work here. Personal Outlook/Hotmail accounts can no longer connect this way; use a Gmail, Zoho or other mailbox instead. (Microsoft 365 business mailboxes work only if the admin enables SMTP AUTH.)', 'proxyai'),
    smtp_auth_failed: __('The mailbox rejected that password. For Gmail/Zoho this must be an app password, not your normal login.', 'proxyai'),
    smtp_incomplete: __('Fill the mailbox address and password first.', 'proxyai'),
    invalid_from: __('That does not look like an email address.', 'proxyai'),
    smtp_unreachable: __('Could not reach that mail server. Check the host and port.', 'proxyai'),
  };

  /** Wizard step 1 — connect the sending mailbox over SMTP. */
  function WizMailboxStep(props) {
    var email = props.email;
    var s1 = useState(false); var busy = s1[0]; var setBusy = s1[1];
    var s2 = useState(null); var error = s2[0]; var setError = s2[1];
    // The password lives in local state only — a credential must never ride
    // the round-tripped helpdesk config.
    var s3 = useState(''); var password = s3[0]; var setPassword = s3[1];
    var s4 = useState(presetForHost(email && email.smtp_host));
    var preset = s4[0]; var setPreset = s4[1];
    var s5 = useState((email && email.smtp_host) || ''); var customHost = s5[0]; var setCustomHost = s5[1];
    var s6 = useState(String((email && email.smtp_port) || 465)); var customPort = s6[0]; var setCustomPort = s6[1];
    var s7 = useState((email && email.smtp_user) || ''); var customUser = s7[0]; var setCustomUser = s7[1];

    var chosen = MAILBOX_PRESETS[0];
    MAILBOX_PRESETS.forEach(function (p) { if (p.id === preset) chosen = p; });
    var editableHost = preset === 'custom' || !!chosen.hostPlaceholder;
    var host = editableHost ? customHost.trim() : chosen.host;
    var port = preset === 'custom' ? (Number(customPort) || 465) : chosen.port;

    var fromEmail = (email && email.from_email) || '';
    var validFrom = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(fromEmail.trim());
    var connected = !!(email && email.provider === 'smtp' && email.connected_at);
    var hasPassword = !!(password.trim() || (connected && email.key_set));
    var oauthConnected = connected && email.auth_kind === 'oauth';

    function attach() {
      setBusy(true);
      setError(null);
      var data = {
        action: 'attach',
        provider: 'smtp',
        from_email: fromEmail,
        from_name: (email && email.from_name) || '',
        smtp_host: host,
        smtp_port: port,
      };
      if (preset === 'custom' && customUser.trim()) data.smtp_user = customUser.trim();
      if (password.trim()) data.smtp_pass = password.trim();
      api('bots/' + props.botId + '/helpdesk/email', { method: 'POST', data: data }).then(
        function () {
          setPassword('');
          props.patchEmail({
            provider: 'smtp',
            key_set: true,
            smtp_host: host,
            smtp_port: port,
            smtp_user: preset === 'custom' && customUser.trim() ? customUser.trim() : undefined,
            connected_at: Math.floor(Date.now() / 1000),
          });
          setBusy(false);
          props.onAttached();
        },
        function (err) {
          setBusy(false);
          setError(SMTP_ERROR[(err && (err.error || err.code)) || ''] || __('Could not connect the mailbox. Try again.', 'proxyai'));
        }
      );
    }

    return el('section', { className: 'pa-wizstep' },
      el('div', { className: 'pa-wizhead' },
        el('span', { className: 'pa-switchrow__label' }, __('Send replies from your own mailbox', 'proxyai')),
        el('p', { className: 'pa-card__fine' },
          __('Optional. Without it, a customer who opened a ticket and closed the tab has no way to learn you replied. Ticket emails go out through the support mailbox you already own — no new accounts, no DNS records. You create an app password and paste it once.', 'proxyai'))),
      el(Field, { label: __('Mailbox provider', 'proxyai') },
        el(SelectInput, {
          value: preset, onChange: setPreset,
          options: MAILBOX_PRESETS.map(function (p) { return { value: p.id, label: p.name }; }),
        })),
      chosen.helpLabel
        ? el('span', { className: 'pa-card__fine' },
            chosen.help
              ? el(Fragment, null,
                  el('a', { href: chosen.help, target: '_blank', rel: 'noreferrer', className: 'pa-link' }, chosen.helpLabel),
                  chosen.oauth ? null : ' — ' + __('then paste it below.', 'proxyai'))
              : chosen.helpLabel)
        : null,
      chosen.oauth
        ? el(Fragment, null,
            el(Field, {
              label: __('From name', 'proxyai'),
              hint: __('Shown beside the address. Defaults to the bot’s name.', 'proxyai'),
            }, el(TextInput, {
              value: (email && email.from_name) || '',
              onChange: function (v) { props.patchEmail({ from_name: v }); },
              placeholder: props.botName || __('Your store', 'proxyai'),
            })),
            el('div', { className: 'pa-wizactions' },
              oauthConnected ? el(Fragment, null, el(ConnPill, null),
                el('span', { className: 'pa-card__fine' },
                  __('Signed in as', 'proxyai') + ' ' + fromEmail + '.')) : null,
              el(Button, {
                variant: 'primary',
                onClick: function () { ssoOpen('/api/helpdesk/email-oauth/' + chosen.oauth + '/start?bot=' + encodeURIComponent(props.botId)); },
              }, oauthConnected ? __('Sign in again', 'proxyai') : __('Sign in with Microsoft', 'proxyai')),
              el('span', { className: 'pa-card__fine' },
                __('The sign-in finishes in the tab that opens; come back here and reload when it’s done. Or press Next to skip email for now.', 'proxyai'))))
        : el(Fragment, null,
            editableHost
              ? el(FieldRow, null,
                  el(Field, { label: __('SMTP host', 'proxyai') },
                    el(TextInput, { value: customHost, onChange: setCustomHost, placeholder: chosen.hostPlaceholder || 'smtp.example.com' })),
                  preset === 'custom'
                    ? el(Field, { label: __('Port', 'proxyai'), hint: __('465 = TLS, 587 = STARTTLS.', 'proxyai') },
                        el(TextInput, { value: customPort, onChange: setCustomPort, placeholder: '465' }))
                    : el('span', null))
              : null,
            preset === 'custom'
              ? el(Field, {
                  label: __('SMTP username (optional)', 'proxyai'),
                  hint: __('Only when your provider logs in with a fixed username instead of the address — e.g. “api_token” for Cloudflare, “apikey” for SendGrid.', 'proxyai'),
                }, el(TextInput, { value: customUser, onChange: setCustomUser, placeholder: __('Defaults to the mailbox address', 'proxyai') }))
              : null,
            el(FieldRow, null,
              el(Field, {
                label: __('Support mailbox', 'proxyai'),
                hint: __('The address customers see and reply to. Also the SMTP login.', 'proxyai'),
              }, el(TextInput, {
                value: fromEmail,
                onChange: function (v) { props.patchEmail({ from_email: v }); },
                placeholder: 'support@yourstore.com',
              })),
              el(Field, { label: chosen.passLabel || __('App password', 'proxyai') },
                el(TextInput, {
                  type: 'password', value: password, onChange: setPassword,
                  placeholder: connected && email.key_set
                    ? __('******** (saved — paste to replace)', 'proxyai')
                    : __('Paste it here', 'proxyai'),
                }))),
            el(Field, {
              label: __('From name', 'proxyai'),
              hint: __('Shown beside the address. Defaults to the bot’s name.', 'proxyai'),
            }, el(TextInput, {
              value: (email && email.from_name) || '',
              onChange: function (v) { props.patchEmail({ from_name: v }); },
              placeholder: props.botName || __('Your store', 'proxyai'),
            })),
            el('div', { className: 'pa-wizactions' },
              connected ? el(Fragment, null, el(ConnPill, null),
                el('span', { className: 'pa-card__fine' }, fromEmail + ' ' + __('connected.', 'proxyai'))) : null,
              el(Button, {
                variant: 'primary', busy: busy,
                disabled: !validFrom || !hasPassword || busy || (editableHost && !host),
                onClick: attach,
              }, busy ? __('Testing mailbox…', 'proxyai') : connected ? __('Reconnect', 'proxyai') : __('Connect mailbox', 'proxyai')),
              !connected
                ? el('span', { className: 'pa-card__fine' }, __('Or press Next to skip email for now.', 'proxyai'))
                : null,
              error ? el('span', { className: 'pa-saverow__err' }, error) : null)));
  }

  /** Wizard step 2 — the inbound leg: replies land on the board. */
  function WizForwardStep(props) {
    var email = props.email;
    var s1 = useState(false); var checking = s1[0]; var setChecking = s1[1];
    var s2 = useState(false); var error = s2[0]; var setError = s2[1];

    if (!email || !email.connected_at) {
      return el('section', { className: 'pa-wizstep' },
        el('span', { className: 'pa-switchrow__label' }, __('Replies to your board', 'proxyai')),
        el('p', { className: 'pa-card__fine' },
          __('Nothing to do — no mailbox is connected. Go back a step if you want customers to get your replies by email, or carry on without it.', 'proxyai')));
    }
    if (!props.inboundDomain) {
      return el('section', { className: 'pa-wizstep' },
        el('span', { className: 'pa-switchrow__label' }, __('Replies to your board', 'proxyai')),
        el('p', { className: 'pa-card__fine' },
          __('Your mailbox is connected and sending. Reply ingestion is not enabled on this deployment yet — customer replies arrive in your mailbox as normal.', 'proxyai')));
    }

    var forwardTo = props.botId.slice(0, 8) + '@' + props.inboundDomain;
    var confirm = email.forward_confirm;
    var isGmail = ((email.smtp_host) || '').indexOf('gmail') !== -1;

    function check() {
      setChecking(true);
      setError(false);
      api('bots/' + props.botId + '/helpdesk/email', { method: 'POST', data: {} }).then(
        function (data) {
          props.patchEmail({ forward_confirm: (data && data.forward_confirm) || null });
          setChecking(false);
        },
        function () { setError(true); setChecking(false); }
      );
    }

    return el('section', { className: 'pa-wizstep' },
      el('div', { className: 'pa-wizhead' },
        el('span', { className: 'pa-switchrow__label' }, __('Replies land on your board', 'proxyai')),
        el('p', { className: 'pa-card__fine' },
          __('Already working: every ticket email we send carries a reply address that routes the customer’s answer straight onto this board. The optional step below also turns emails customers send directly to your support address into new tickets.', 'proxyai'))),
      email.inbound_paused
        ? el(Notice, { kind: 'error' },
            __('Inbound email is paused — your credits are used up. Incoming mail is being bounced back to the sender (and not charged) until you top up.', 'proxyai'))
        : null,
      el('div', { className: 'pa-wizbox' },
        el('span', { className: 'pa-switchrow__label' }, __('Optional — new tickets from your inbox', 'proxyai')),
        el('p', { className: 'pa-card__fine' },
          __('Forward', 'proxyai') + ' ' + (email.from_email || '') + ' ' +
          __('to the address below and every customer email opens a ticket here, not just replies.', 'proxyai')),
        el('div', { className: 'pa-wizforward' },
          el('code', { className: 'pa-copyfield__value' }, forwardTo),
          el(CopyChip, { value: forwardTo })),
        isGmail
          ? el('ol', { className: 'pa-wizlist' },
              el('li', null,
                __('Open', 'proxyai') + ' ',
                el('a', { href: 'https://mail.google.com/mail/u/0/#settings/fwdandpop', target: '_blank', rel: 'noreferrer', className: 'pa-link' },
                  __('Gmail → Forwarding settings', 'proxyai')),
                ' ' + __('and add the address above.', 'proxyai')),
              el('li', null, __('Gmail sends a confirmation code — to us. Press the button below and the code appears here; type it back into Gmail.', 'proxyai')),
              el('li', null, __('Choose “keep a copy in inbox” so your mailbox stays complete.', 'proxyai')))
          : el('p', { className: 'pa-card__fine' },
              __('Add a forwarding rule in your mail provider’s settings pointing at the address above. If it asks to confirm the target, press the button below — any confirmation code it mailed shows up here.', 'proxyai')),
        el('div', { className: 'pa-wizactions' },
          el(Button, { variant: 'primary', busy: checking, onClick: check },
            checking ? __('Checking…', 'proxyai') : __('Fetch confirmation code', 'proxyai')),
          confirm && confirm.code
            ? el('span', { className: 'pa-wizcode' },
                __('Code:', 'proxyai') + ' ',
                el('code', { className: 'pa-copyfield__value' }, confirm.code),
                el(CopyChip, { value: confirm.code }))
            : null,
          confirm && !confirm.code && confirm.link
            ? el('a', { href: confirm.link, target: '_blank', rel: 'noreferrer', className: 'pa-link' },
                __('Open confirmation link', 'proxyai'))
            : null,
          error ? el('span', { className: 'pa-saverow__err' }, __('Could not check right now. Try again.', 'proxyai')) : null)),
      el('button', {
        type: 'button', className: 'pa-linkdanger',
        onClick: function () { props.onDisconnectEmail(); },
      }, __('Disconnect email', 'proxyai')));
  }

  var TEMPLATE_PREVIEW_VARS = {
    customer_name: 'Alex',
    ticket_number: 'PA-1042',
    category: 'Order issue',
    issue: 'Damaged mug, requesting replacement',
    reply: 'Sorry about the mug — a replacement is on its way and should reach you in 3–5 days.',
  };

  /** Preview only; the real substitution and escaping happen server-side. */
  function fillTemplatePreview(html) {
    return html.replace(/\{\{\s*(\w+)\s*\}\}/g, function (whole, key) {
      return TEMPLATE_PREVIEW_VARS[key] || whole;
    });
  }

  var TEMPLATE_ERROR = {
    insufficient_credits: __('Not enough credit to run the writer.', 'proxyai'),
    empty_input: __('Enter your company name first.', 'proxyai'),
    missing_reply_placeholder: __('The template must contain {{reply}} — that is where the message goes.', 'proxyai'),
  };

  /** Wizard step 4 — the branded wrapper an agent's reply is sent inside. */
  function WizTemplateStep(props) {
    var saved = (props.email && props.email.template) || null;
    var s1 = useState((saved && saved.company) || props.botName || ''); var company = s1[0]; var setCompany = s1[1];
    var s2 = useState((saved && saved.logo_url) || ''); var logoUrl = s2[0]; var setLogoUrl = s2[1];
    var s3 = useState((saved && saved.style) || ''); var style = s3[0]; var setStyle = s3[1];
    var s4 = useState((saved && saved.html) || ''); var html = s4[0]; var setHtml = s4[1];
    var s5 = useState(null); var busy = s5[0]; var setBusy = s5[1];
    var s6 = useState(null); var error = s6[0]; var setError = s6[1];
    var s7 = useState(false); var savedNow = s7[0]; var setSavedNow = s7[1];
    var s8 = useState(false); var editingHtml = s8[0]; var setEditingHtml = s8[1];
    var fileRef = useRef(null);

    function uploadLogo(file) {
      setBusy('logo');
      setError(null);
      if (file.size > 2 * 1024 * 1024) {
        setError(__('Logos are limited to 2MB.', 'proxyai'));
        setBusy(null);
        return;
      }
      var body = new window.FormData();
      body.append('kind', 'icon');
      body.append('file', file);
      window.fetch(CFG.restUrl + 'proxyai/v1/admin/bots/' + props.botId + '/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': CFG.restNonce },
        body: body,
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data && data.url) setLogoUrl(data.url);
        else setError(data && data.error === 'unsupported_type'
          ? __('Choose a PNG, JPEG, or WebP image.', 'proxyai')
          : __('Upload failed.', 'proxyai'));
      }).catch(function () { setError(__('Upload failed.', 'proxyai')); })
        .then(function () { setBusy(null); });
    }

    function call(action) {
      setBusy(action);
      setError(null);
      setSavedNow(false);
      var data = { action: action, company: company, logo_url: logoUrl, style: style };
      if (action === 'save') data.html = html;
      api('bots/' + props.botId + '/helpdesk/email-template', { method: 'POST', data: data }).then(
        function (res) {
          if (action === 'generate') setHtml((res && res.html) || '');
          else {
            props.patchEmail({ template: { html: html, company: company, logo_url: logoUrl || undefined, style: style || undefined } });
            setSavedNow(true);
          }
          setBusy(null);
        },
        function (err) {
          var code = (err && (err.error || err.code)) || '';
          if (code === 'unknown_placeholder') {
            var names = (err && err.names) || [];
            setError(__('Unknown placeholder(s):', 'proxyai') + ' ' +
              names.map(function (n) { return '{{' + n + '}}'; }).join(', ') + '. ' +
              __('Valid: {{customer_name}}, {{ticket_number}}, {{category}}, {{issue}}, {{reply}}.', 'proxyai'));
          } else {
            setError(TEMPLATE_ERROR[code] || (action === 'save'
              ? __('Could not save the template. Try again.', 'proxyai')
              : __('Could not write the template. Try again.', 'proxyai')));
          }
          setBusy(null);
        }
      );
    }

    return el('section', { className: 'pa-wizstep' },
      el('div', { className: 'pa-wizhead' },
        el('span', { className: 'pa-switchrow__label' }, __('Email template', 'proxyai')),
        el('p', { className: 'pa-card__fine' },
          __('Optional. The wrapper around your reply — your logo, a ticket summary, a sign-off. Without one, replies go out as plain text. Writing it uses your AI credits.', 'proxyai'))),
      el('div', { className: 'pa-wizlogo' },
        el('div', { className: 'pa-wizlogo__pick' },
          el('span', { className: 'pa-field__label' }, __('Logo', 'proxyai')),
          el('button', {
            type: 'button', className: 'pa-avatarbtn',
            onClick: function () { if (fileRef.current) fileRef.current.click(); },
            'aria-label': __('Upload your logo', 'proxyai'),
          },
            logoUrl
              ? el('img', { src: logoUrl, alt: '', className: 'pa-avatarbtn__img' })
              : el('span', { className: 'pa-avatarbtn__empty' }, busy === 'logo' ? '…' : '+')),
          el('input', {
            ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp',
            style: { display: 'none' },
            onChange: function (e) {
              if (e.target.files && e.target.files[0]) uploadLogo(e.target.files[0]);
              e.target.value = '';
            },
          })),
        el('div', { className: 'pa-wizlogo__name' },
          el(Field, { label: __('Company name', 'proxyai') },
            el(TextInput, { value: company, onChange: setCompany, placeholder: 'Acme Coffee' })))),
      el(Field, {
        label: __('Style', 'proxyai'),
        hint: __('Colours, tone, anything you want it to look like. Leave blank for clean and neutral.', 'proxyai'),
      }, el(TextInput, {
        value: style, onChange: setStyle,
        placeholder: __('e.g. warm and friendly, cream background, dark green accents', 'proxyai'),
      })),
      el('div', { className: 'pa-wizactions' },
        el(Button, {
          variant: 'primary', busy: busy === 'generate',
          disabled: !company.trim() || busy !== null,
          onClick: function () { call('generate'); },
        }, busy === 'generate' ? __('Writing…', 'proxyai') : html ? __('Write it again', 'proxyai') : __('Write my template', 'proxyai')),
        el(Button, {
          onClick: function () { setEditingHtml(!editingHtml); },
        }, editingHtml ? __('Hide HTML', 'proxyai') : html ? __('Edit HTML', 'proxyai') : __('Add HTML', 'proxyai')),
        html
          ? el(Button, {
              busy: busy === 'save', disabled: busy !== null,
              onClick: function () { call('save'); },
            }, busy === 'save' ? __('Saving…', 'proxyai') : __('Save template', 'proxyai'))
          : null,
        savedNow ? el('span', { className: 'pa-wizsaved' }, __('Saved.', 'proxyai')) : null,
        error ? el('span', { className: 'pa-saverow__err' }, error) : null),
      editingHtml
        ? el(Field, {
            label: __('Template HTML', 'proxyai'),
            hint: __('{{reply}} is required — it is where the agent’s message lands. Save when done.', 'proxyai'),
          }, el(TextArea, {
            value: html, onChange: setHtml, rows: 12,
            placeholder: __('Paste your template HTML. Must contain {{reply}} where the message goes; {{customer_name}}, {{ticket_number}}, {{category}} and {{issue}} also fill in.', 'proxyai'),
          }))
        : null,
      html
        ? el('div', { className: 'pa-wizpreview' },
            el('span', { className: 'pa-field__label' }, __('Preview — with a sample ticket filled in', 'proxyai')),
            // Sandboxed: the HTML is model output and must not be able to
            // run scripts or navigate wp-admin.
            el('iframe', {
              title: __('Email template preview', 'proxyai'),
              sandbox: '', scrolling: 'no',
              srcDoc: fillTemplatePreview(html),
              className: 'pa-wizpreview__frame',
            }))
        : null);
  }

  /**
   * Ticket-form guide on the wizard's last step. Documents only the
   * WordPress/Woo path — the block and the shortcode.
   */
  function TicketGuide() {
    function guideStep(n, children) {
      return el('div', { className: 'pa-guidestep' },
        el('span', { className: 'pa-connectsteps__num' }, String(n)),
        el('div', { className: 'pa-guidestep__body' }, children));
    }

    return el('div', { className: 'pa-ticketguide' },
      el('span', { className: 'pa-switchrow__label' }, __('Ticket form for your website', 'proxyai')),
      el('p', { className: 'pa-card__fine' },
        __('A standalone “Open a ticket” form customers can use without chatting to the bot. Tickets land on this same board. Only signed-in customers can submit — logins are verified cryptographically, so nobody can file or read tickets as someone else.', 'proxyai')),
      guideStep(1, el('span', null,
        __('Edit the page you want the form on and add the ', 'proxyai'),
        el('strong', null, __('ProxyAI Support Tickets', 'proxyai')),
        __(' block — search for it in the block inserter.', 'proxyai'))),
      guideStep(2, __('Done. The ProxyAI plugin signs your logged-in customers in automatically; logged-out visitors see a “log in first” note.', 'proxyai')),
      guideStep(3, el('span', null,
        __('On the classic editor, or inside another block’s content, this shortcode does the same thing: ', 'proxyai'),
        el(CopyChip, { value: '[proxyai_tickets]' }))));
  }

  var WIZ_STEPS = [
    __('Connect mailbox', 'proxyai'),
    __('Replies to board', 'proxyai'),
    __('Auto-archive', 'proxyai'),
    __('Email template', 'proxyai'),
    __('Ticket form', 'proxyai'),
  ];

  /**
   * Setup wizard for the built-in desk — five skippable screens. Everything
   * but the mailbox test and the template (their own endpoints) stays local
   * until Finish, which writes the helpdesk section once.
   */
  function HelpdeskWizard(props) {
    var s1 = useState(0); var step = s1[0]; var setStep = s1[1];
    var last = step === WIZ_STEPS.length - 1;
    var hd = props.helpdesk;

    var body;
    switch (step) {
      case 1:
        body = el(WizForwardStep, {
          botId: props.botId, email: hd.email,
          inboundDomain: hd.inbound_domain || '',
          patchEmail: props.patchEmail,
          onDisconnectEmail: function () { props.setEmail(null); },
        });
        break;
      case 2:
        body = el('section', { className: 'pa-wizstep' },
          el('div', { className: 'pa-wizhead' },
            el('span', { className: 'pa-switchrow__label' }, __('Auto-archive resolved tickets', 'proxyai')),
            el('p', { className: 'pa-card__fine' },
              __('Housekeeping for your board: resolved tickets older than this move to Archived. Nothing is deleted.', 'proxyai'))),
          el(Field, { label: __('Archive after', 'proxyai') },
            el(SelectInput, {
              value: String(hd.auto_archive_days || 0),
              onChange: function (v) { props.patch({ auto_archive_days: Number(v) || 0 }); },
              options: [
                { value: '0', label: __('Never', 'proxyai') },
                { value: '7', label: __('After 7 days', 'proxyai') },
                { value: '14', label: __('After 14 days', 'proxyai') },
                { value: '30', label: __('After 30 days', 'proxyai') },
                { value: '90', label: __('After 90 days', 'proxyai') },
              ],
            })),
          el('div', { className: 'pa-wizhead' },
            el('span', { className: 'pa-switchrow__label' }, __('Auto-resolve pending tickets', 'proxyai')),
            el('p', { className: 'pa-card__fine' },
              __('A ticket you replied to, where the customer never came back. After this window it moves to Resolved on its own — nothing to do.', 'proxyai'))),
          el(Field, { label: __('Resolve after', 'proxyai') },
            el(SelectInput, {
              value: String(hd.auto_resolve_pending_days || 0),
              onChange: function (v) { props.patch({ auto_resolve_pending_days: Number(v) || 0 }); },
              options: [
                { value: '0', label: __('Never', 'proxyai') },
                { value: '3', label: __('After 3 days', 'proxyai') },
                { value: '7', label: __('After 7 days', 'proxyai') },
                { value: '14', label: __('After 14 days', 'proxyai') },
                { value: '30', label: __('After 30 days', 'proxyai') },
              ],
            })));
        break;
      case 3:
        body = el(WizTemplateStep, {
          botId: props.botId, botName: props.botName,
          email: hd.email, patchEmail: props.patchEmail,
        });
        break;
      case 4:
        body = el('section', { className: 'pa-wizstep' },
          el('div', { className: 'pa-wizhead' },
            el('span', { className: 'pa-switchrow__label' }, __('Ticket categories', 'proxyai')),
            el('p', { className: 'pa-card__fine' },
              __('What a customer can file a ticket under. Both routes use this list — the form shows it as a dropdown, and the bot picks from it when it opens a ticket from chat — so the board never grows a category you did not choose.', 'proxyai'))),
          el(Field, { label: __('Categories', 'proxyai'), hint: __('One per line — e.g. “Refund or return”.', 'proxyai') },
            el(TextArea, {
              value: (hd.ticket_categories || []).join('\n'), rows: 4,
              onChange: function (v) {
                props.patch({
                  ticket_categories: v.split('\n').map(function (c) { return c.trim(); }).filter(Boolean),
                });
              },
            })),
          el(TicketGuide, null));
        break;
      default:
        body = el(WizMailboxStep, {
          botId: props.botId, botName: props.botName,
          email: hd.email, patchEmail: props.patchEmail,
          onAttached: function () { setStep(1); },
        });
    }

    return el('div', { className: 'pa-dialog', role: 'dialog', 'aria-modal': 'true' },
      el('div', { className: 'pa-dialog__scrim', onClick: props.onClose }),
      el('div', { className: 'pa-dialog__panel pa-wizard' },
        el('button', {
          type: 'button', className: 'pa-dialog__close', 'aria-label': __('Close', 'proxyai'),
          onClick: props.onClose,
        }, '×'),
        el('div', { className: 'pa-wizard__head' },
          el('h2', { className: 'pa-card__title' }, __('Set up your ticket desk', 'proxyai')),
          el('p', { className: 'pa-card__fine' },
            __('Five short steps. You can skip any of them and come back — the desk works either way.', 'proxyai'))),
        el('div', { className: 'pa-wizbar' },
          WIZ_STEPS.map(function (label, i) {
            return el('button', {
              key: label, type: 'button',
              className: 'pa-wizbar__step' + (i === step ? ' is-active' : ''),
              onClick: function () { setStep(i); },
            },
              el('span', { className: 'pa-wizbar__num' }, i < step ? '✓' : String(i + 1)),
              label);
          })),
        el('div', { className: 'pa-wizard__body' }, body),
        el('div', { className: 'pa-wizard__foot' },
          el(Button, {
            disabled: step === 0,
            onClick: function () { setStep(Math.max(0, step - 1)); },
          }, __('Back', 'proxyai')),
          el('span', { className: 'pa-card__fine' },
            __('Step', 'proxyai') + ' ' + (step + 1) + ' ' + __('of', 'proxyai') + ' ' + WIZ_STEPS.length),
          el(Button, {
            variant: 'primary',
            onClick: function () {
              if (last) { props.onFinish(); props.onClose(); }
              else setStep(step + 1);
            },
          }, last ? __('Finish', 'proxyai') : __('Next', 'proxyai')))));
  }

  var DESK_CARDS = [
    { key: 'gorgias', name: 'Gorgias', description: __('Ecommerce helpdesk. Tickets arrive with the chat transcript; agent replies relay back to the customer’s chat.', 'proxyai') },
    { key: 'zendesk', name: 'Zendesk', description: __('Support suite. The bot files tickets into your Zendesk with the conversation and order context attached.', 'proxyai') },
    { key: 'freshdesk', name: 'Freshdesk', description: __('Tickets land in your Freshdesk with full context; your agents follow up with the customer by email.', 'proxyai') },
    { key: 'helpscout', name: 'Help Scout', description: __('Shared inbox. Conversations open in your mailbox; agent replies relay back to the customer’s chat.', 'proxyai') },
  ];

  function HelpdeskPane(props) {
    var fp = props.formProps;
    var s1 = useState(fp.initialHelpdesk || { connections: [] });
    var hd = s1[0]; var setHd = s1[1];
    var s2 = useState(null); var openCard = s2[0]; var setOpenCard = s2[1];
    var s3 = useState(false); var wizardOpen = s3[0]; var setWizardOpen = s3[1];
    var saver = useSave('helpdesk', props.botId);
    var botName = (fp.initialIdentity && fp.initialIdentity.name) || '';

    function patch(fields) {
      setHd(function (prev) {
        var next = {};
        Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
        Object.keys(fields).forEach(function (k) { next[k] = fields[k]; });
        return next;
      });
    }
    function conn(provider) {
      var found = null;
      (hd.connections || []).forEach(function (c) { if (c.provider === provider) found = c; });
      return found || { provider: provider };
    }
    // One desk per bot: editing a provider replaces the configured desk.
    // The server enforces the same rule.
    function setConn(provider, fields) {
      setHd(function (prev) {
        var current = { provider: provider };
        (prev.connections || []).forEach(function (c) {
          if (c.provider === provider) current = c;
        });
        var merged = {};
        Object.keys(current).forEach(function (k) { merged[k] = current[k]; });
        Object.keys(fields).forEach(function (k) { merged[k] = fields[k]; });
        var next = {};
        Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
        next.connections = [merged];
        return next;
      });
    }
    // Only a usable connection persists: built-in needs nothing, key-mode
    // needs credentials, OAuth at least a domain.
    function payload(over) {
      var source = over || hd;
      return {
        connections: (source.connections || []).filter(function (c) {
          return c.provider === 'proxyai' || c.api_key || c.oauthConnected || c.domain || c.mailbox_id;
        }).slice(0, 1),
        auto_archive_days: source.auto_archive_days || 0,
        auto_resolve_pending_days: source.auto_resolve_pending_days || 0,
        ticket_categories: source.ticket_categories || [],
        // undefined leaves the stored mail account alone; null disconnects.
        email: source.email === null ? null : (source.email && source.email.from_email ? source.email : undefined),
        // Round-tripped as-is so a Helpdesk save cannot reset toggles set
        // from the Store actions tab.
        open_tickets: source.open_tickets,
        email_capture: source.email_capture,
        order_lookup: source.order_lookup,
      };
    }
    var activeDesk = null;
    (hd.connections || []).forEach(function (c) {
      if (!activeDesk && (c.provider === 'proxyai' || c.api_key || c.oauthConnected || c.mailbox_id)) {
        activeDesk = c.provider;
      }
    });
    function disconnectDesk() {
      patch({ connections: [] });
      setOpenCard(null);
      saver.save({ connections: [] }).catch(function () {});
    }
    function patchEmail(fields) {
      setHd(function (prev) {
        var base = prev.email && typeof prev.email === 'object' ? prev.email : {};
        var email = { provider: 'smtp' };
        Object.keys(base).forEach(function (k) { email[k] = base[k]; });
        Object.keys(fields).forEach(function (k) { email[k] = fields[k]; });
        var next = {};
        Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
        next.email = email;
        return next;
      });
    }
    function connectRow(label) {
      return el('div', { className: 'pa-saverow pa-deskcard__saverow' },
        saver.state === 'saved' ? el('span', { className: 'pa-wizsaved' }, __('Saved', 'proxyai')) : null,
        saver.state === 'error' ? el('span', { className: 'pa-saverow__err' }, __('Could not save. Try again.', 'proxyai')) : null,
        el(Button, {
          variant: 'primary', busy: saver.state === 'saving',
          onClick: function () { saver.save(payload()).catch(function () {}); },
        }, saver.state === 'saving' ? __('Saving…', 'proxyai') : label));
    }

    function deskCard(card) {
      var c = conn(card.key);
      var connected = card.key === 'gorgias' || card.key === 'freshdesk'
        ? !!c.api_key
        : !!c.oauthConnected;
      var open = openCard === card.key;
      var blocked = !connected && activeDesk !== null && activeDesk !== card.key;
      var toggle = el('button', {
        type: 'button',
        className: open || connected ? 'pa-link' : 'pa-minibtn',
        disabled: blocked,
        title: blocked ? __('Disconnect the current desk first', 'proxyai') : undefined,
        onClick: function () { setOpenCard(open ? null : card.key); },
      }, open ? __('Close', 'proxyai') : connected ? __('Manage', 'proxyai') : __('Connect', 'proxyai'));

      var form = null;
      if (open) {
        if (card.key === 'gorgias') {
          form = el(Fragment, null,
            el(Field, { label: __('Account domain', 'proxyai') },
              el(TextInput, { value: c.domain || '', onChange: function (v) { setConn('gorgias', { domain: v }); }, placeholder: 'acme (from acme.gorgias.com)' })),
            el(Field, { label: __('Account email', 'proxyai'), hint: __('The email of the Gorgias user the API key belongs to.', 'proxyai') },
              el(TextInput, { value: c.email || '', onChange: function (v) { setConn('gorgias', { email: v }); }, placeholder: 'you@acme.com' })),
            el(Field, { label: __('API key', 'proxyai'), hint: __('Gorgias → Settings → REST API. Saving also registers the reply webhook.', 'proxyai') },
              el(TextInput, { type: 'password', value: c.api_key || '', onChange: function (v) { setConn('gorgias', { api_key: v }); } })),
            c.webhook_status === 'registered'
              ? el('span', { className: 'pa-card__fine' },
                  __('Agent replies in Gorgias relay back to the customer’s chat.', 'proxyai'))
              : null,
            connectRow(connected ? __('Save changes', 'proxyai') : __('Connect', 'proxyai')));
        } else if (card.key === 'zendesk') {
          form = el(Fragment, null,
            el(Field, { label: __('Subdomain', 'proxyai') },
              el(TextInput, { value: c.domain || '', onChange: function (v) { setConn('zendesk', { domain: v }); }, placeholder: 'acme (from acme.zendesk.com)' })),
            el('div', null,
              el(Button, {
                variant: 'primary', disabled: !c.domain,
                onClick: function () {
                  saver.save(payload()).catch(function () {});
                  ssoOpen('/api/helpdesk/oauth/zendesk/start?bot=' + encodeURIComponent(props.botId) + '&subdomain=' + encodeURIComponent(c.domain || ''));
                },
              }, connected ? __('Reconnect with Zendesk', 'proxyai') : __('Connect with Zendesk', 'proxyai'))),
            el('span', { className: 'pa-card__fine' },
              __('The connection finishes in the tab that opens; come back here and reload when it’s done.', 'proxyai')));
        } else if (card.key === 'freshdesk') {
          form = el(Fragment, null,
            el(Field, { label: __('Account domain', 'proxyai') },
              el(TextInput, { value: c.domain || '', onChange: function (v) { setConn('freshdesk', { domain: v }); }, placeholder: 'acme (from acme.freshdesk.com)' })),
            el(Field, { label: __('API key', 'proxyai'), hint: __('Freshdesk → Profile settings → View API key. Agents reply from Freshdesk by email.', 'proxyai') },
              el(TextInput, { type: 'password', value: c.api_key || '', onChange: function (v) { setConn('freshdesk', { api_key: v }); } })),
            connectRow(connected ? __('Save changes', 'proxyai') : __('Connect', 'proxyai')));
        } else {
          form = el(Fragment, null,
            el('div', null,
              el(Button, {
                variant: 'primary',
                onClick: function () {
                  ssoOpen('/api/helpdesk/oauth/helpscout/start?bot=' + encodeURIComponent(props.botId));
                },
              }, connected ? __('Reconnect with Help Scout', 'proxyai') : __('Connect with Help Scout', 'proxyai'))),
            el('span', { className: 'pa-card__fine' },
              __('The connection finishes in the tab that opens; come back here and reload when it’s done.', 'proxyai')),
            connected
              ? el(Fragment, null,
                  el(Field, { label: __('Mailbox ID', 'proxyai'), hint: __('Defaults to your first mailbox when you connect.', 'proxyai') },
                    el(TextInput, {
                      value: c.mailbox_id == null ? '' : String(c.mailbox_id),
                      onChange: function (v) { setConn('helpscout', { mailbox_id: Number(v) || undefined }); },
                    })),
                  connectRow(__('Save mailbox', 'proxyai')))
              : null);
        }
      }

      return el('div', { key: card.key, className: 'pa-deskcard' },
        el('div', { className: 'pa-deskcard__top' },
          el(DeskIcon, { name: card.key }),
          el('div', { className: 'pa-deskcard__actions' },
            connected
              ? el(Fragment, null, el(ConnPill, null),
                  el('button', { type: 'button', className: 'pa-linkdanger', onClick: disconnectDesk },
                    __('Disconnect', 'proxyai')))
              : toggle)),
        el('div', { className: 'pa-deskcard__text' },
          el('span', { className: 'pa-switchrow__label' }, card.name),
          el('p', { className: 'pa-card__fine' }, card.description)),
        form ? el('div', { className: 'pa-deskcard__form' }, form) : null,
        connected ? el('div', { className: 'pa-deskcard__foot' }, toggle) : null);
    }

    var builtinConnected = activeDesk === 'proxyai';
    var emailObj = hd.email && typeof hd.email === 'object' ? hd.email : null;

    return el(
      Fragment,
      null,
      el('p', { className: 'pa-pane__lede' },
        __('Pick where the bot opens support tickets — the built-in inbox, or the helpdesk you already use. Tickets arrive with the chat transcript attached; one desk per bot.', 'proxyai')),

      // Tickets require a signed-in customer; the plugin proves it
      // automatically on WordPress.
      el('div', { className: 'pa-deskcard pa-identitybox' },
        el('span', { className: 'pa-switchrow__label' }, __('Customer identity', 'proxyai')),
        el('p', { className: 'pa-card__fine' },
          __('Tickets can only be opened by customers who are signed in to your store — the bot asks anonymous visitors to log in first. On WordPress/WooCommerce this works automatically: the plugin signs your logged-in customers in, nothing to set up.', 'proxyai'))),

      // Built-in desk: no credentials — tickets open straight into this
      // dashboard's agent inbox.
      el('div', { className: 'pa-deskcard' },
        el('div', { className: 'pa-deskcard__top' },
          el(DeskIcon, { name: 'proxyai' }),
          el('div', { className: 'pa-deskcard__actions' },
            builtinConnected
              ? el(Fragment, null, el(ConnPill, null),
                  el('button', { type: 'button', className: 'pa-linkdanger', onClick: disconnectDesk },
                    __('Disconnect', 'proxyai')))
              : el('button', {
                  type: 'button', className: 'pa-minibtn',
                  disabled: activeDesk !== null,
                  title: activeDesk !== null ? __('Disconnect the current desk first', 'proxyai') : undefined,
                  onClick: function () {
                    // Connect before opening the wizard, so abandoning it
                    // halfway still leaves a working board.
                    var connections = [{ provider: 'proxyai', enabled: true }];
                    patch({ connections: connections });
                    var next = {};
                    Object.keys(hd).forEach(function (k) { next[k] = hd[k]; });
                    next.connections = connections;
                    saver.save(payload(next)).catch(function () {});
                    setWizardOpen(true);
                  },
                }, __('Use built-in', 'proxyai')))),
        el('div', { className: 'pa-deskcard__text' },
          el('span', { className: 'pa-switchrow__label' }, __('ProxyAI Tickets — built-in', 'proxyai')),
          el('p', { className: 'pa-card__fine' },
            __('Runs entirely inside ProxyAI: tickets open in your ', 'proxyai'),
            props.onNavigate
              ? el('button', {
                  type: 'button', className: 'pa-link',
                  onClick: function () { props.onNavigate('tickets'); },
                }, __('Support Tickets', 'proxyai'))
              : el('span', null, __('Support Tickets', 'proxyai')),
            __(' inbox with a PA ticket number, and your replies reach the customer back on their chat channel. No accounts, no keys, nothing leaves ProxyAI.', 'proxyai'))),
        builtinConnected
          ? el('div', { className: 'pa-deskcard__summary' },
              el(SetupRow, {
                label: __('Email replies', 'proxyai'),
                hint: __('Optional. Connect the support mailbox you already own with an app password — then it is 1¢ per reply we email. Customer replies route back onto this board automatically.', 'proxyai'),
                value: !(emailObj && emailObj.connected_at)
                  ? __('Off — replies reach the customer on their chat channel only', 'proxyai')
                  : __('Sending from', 'proxyai') + ' ' + (emailObj.from_email || ''),
              }),
              el(SetupRow, {
                label: __('Auto-archive', 'proxyai'),
                value: hd.auto_archive_days
                  ? __('Resolved tickets archive after', 'proxyai') + ' ' + hd.auto_archive_days + ' ' + __('days', 'proxyai')
                  : __('Never', 'proxyai'),
              }),
              el(SetupRow, {
                label: __('Auto-resolve pending', 'proxyai'),
                value: hd.auto_resolve_pending_days
                  ? __('Pending tickets resolve after', 'proxyai') + ' ' + hd.auto_resolve_pending_days + ' ' + __('days', 'proxyai')
                  : __('Never', 'proxyai'),
              }),
              el(SetupRow, {
                label: __('Categories', 'proxyai'),
                value: (hd.ticket_categories || []).join(', ') || __('Not set', 'proxyai'),
              }),
              el(SetupRow, {
                label: __('Email template', 'proxyai'),
                value: emailObj && emailObj.template && emailObj.template.html
                  ? __('Branded wrapper saved', 'proxyai')
                  : __('Plain text — no template written yet', 'proxyai'),
              }),
              el('div', { className: 'pa-deskcard__foot' },
                el(Button, { onClick: function () { setWizardOpen(true); } }, __('Open setup', 'proxyai'))))
          : null),

      wizardOpen
        ? el(HelpdeskWizard, {
            botId: props.botId, botName: botName,
            helpdesk: hd, patch: patch, patchEmail: patchEmail,
            setEmail: function (v) { patch({ email: v }); },
            onClose: function () { setWizardOpen(false); },
            // The template saves itself; everything else writes once on Finish.
            onFinish: function () { saver.save(payload()).catch(function () {}); },
          })
        : null,

      // Independent columns so an expanded card grows its own column only.
      el('div', { className: 'pa-deskgrid' },
        el('div', { className: 'pa-deskgrid__col' }, [DESK_CARDS[0], DESK_CARDS[2]].map(deskCard)),
        el('div', { className: 'pa-deskgrid__col' }, [DESK_CARDS[1], DESK_CARDS[3]].map(deskCard))),

      el('p', { className: 'pa-card__fine' },
        __('One desk per bot: connecting a different desk replaces the current one. The bot only offers ticket creation when a desk is connected.', 'proxyai'))
    );
  }

  // --- Channels: card grid, one modal per channel ------------------------
  // Each modal mirrors its BotConfigForm twin.

  /** Opens the app signed in (SSO hop) at a relative path, in a new tab. */
  function ssoOpen(nextPath) {
    var launch = CFG.launch || {};
    var form = document.createElement('form');
    form.method = 'post';
    form.action = launch.url || '';
    form.target = '_blank';
    [['action', launch.action], ['_wpnonce', launch.nonce], ['next', nextPath]].forEach(function (pair) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = pair[0];
      input.value = pair[1] || '';
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    form.remove();
  }

  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    var area = document.createElement('textarea');
    area.value = value;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    return Promise.resolve();
  }

  /** A chip carrying a value worth copying, e.g. /newbot. */
  function CopyChip(props) {
    var s1 = useState(false); var copied = s1[0]; var setCopied = s1[1];
    return el('button', {
      type: 'button', className: 'pa-copychip',
      title: __('Copy to clipboard', 'proxyai'),
      onClick: function () {
        copyText(props.value);
        setCopied(true);
        window.setTimeout(function () { setCopied(false); }, 1500);
      },
    }, copied ? __('Copied', 'proxyai') : props.value);
  }

  /** Read-only value with reveal (for secrets) and copy. Mirrors CopyField. */
  function CopyField(props) {
    var s1 = useState(!props.secret); var revealed = s1[0]; var setRevealed = s1[1];
    var s2 = useState(false); var copied = s2[0]; var setCopied = s2[1];
    return el('div', { className: 'pa-copyfield' },
      el('div', { className: 'pa-copyfield__head' },
        el('span', { className: 'pa-field__label' }, props.label),
        el('span', { className: 'pa-copyfield__actions' },
          props.secret
            ? el('button', {
                type: 'button', className: 'pa-link',
                onClick: function () { setRevealed(!revealed); },
              }, revealed ? __('Hide', 'proxyai') : __('Show', 'proxyai'))
            : null,
          el('button', {
            type: 'button', className: 'pa-link',
            onClick: function () {
              copyText(props.value);
              setCopied(true);
              window.setTimeout(function () { setCopied(false); }, 1500);
            },
          }, copied ? '✓ ' + __('Copied', 'proxyai') : __('Copy', 'proxyai')))),
      el('code', { className: 'pa-copyfield__value' },
        revealed ? props.value : '••••••••••••••••••••'));
  }

  /** Guided console walkthrough, mirroring ConnectSteps. */
  function ConnectSteps(props) {
    return el('div', { className: 'pa-connectsteps' },
      el('div', { className: 'pa-connectsteps__head' },
        el('span', { className: 'pa-switchrow__label' }, props.title),
        el('a', {
          href: props.ctaHref, target: '_blank', rel: 'noopener noreferrer',
          className: 'pa-minibtn',
        }, props.ctaLabel)),
      el('ol', { className: 'pa-connectsteps__list' },
        props.steps.map(function (s, i) {
          return el('li', { key: i },
            el('span', { className: 'pa-connectsteps__num' }, String(i + 1)),
            // The body wraps within itself so a long step never strands the
            // number on its own line.
            el('span', { className: 'pa-connectsteps__body' },
              s.text,
              s.chip ? el(CopyChip, { value: s.chip }) : null,
              s.note ? el('span', { className: 'pa-connectsteps__note' }, s.note) : null));
        })));
  }

  /** One-click connect banner, mirroring OAuthConnectSection. The action
      rides the SSO hop so the new tab arrives signed in. */
  function OAuthSection(props) {
    return el('div', { className: 'pa-connectsteps' },
      el('div', { className: 'pa-connectsteps__head' },
        el('span', { className: 'pa-connectsteps__text' },
          el('span', { className: 'pa-switchrow__label' }, props.title),
          el('span', { className: 'pa-connectsteps__note' }, props.subtitle)),
        props.enabled
          ? el('button', {
              type: 'button', className: 'pa-minibtn',
              onClick: function () { ssoOpen(props.next); },
            }, props.actionLabel)
          : el('span', {
              className: 'pa-minibtn pa-minibtn--off',
              title: __('The shared platform app is not configured yet.', 'proxyai'),
            }, __('Coming soon', 'proxyai'))));
  }

  function AdvancedDivider(props) {
    return el('div', { className: 'pa-advdivider' },
      el('span', { className: 'pa-advdivider__line' }),
      el('span', { className: 'pa-advdivider__label' },
        props.label || __('Advanced — manual setup', 'proxyai')),
      el('span', { className: 'pa-advdivider__line' }));
  }

  function SaveNote(props) {
    return el('p', { className: 'pa-savenote', title: props.text },
      __('What happens when you save', 'proxyai') + ' ⓘ');
  }

  /** Shared modal shell: scrim, panel, brand-marked title. */
  function ModalShell(props) {
    return el('div', { className: 'pa-dialog', role: 'dialog', 'aria-modal': 'true' },
      el('div', { className: 'pa-dialog__scrim', onClick: props.onClose }),
      el('div', { className: 'pa-dialog__panel' },
        el('button', {
          type: 'button', className: 'pa-dialog__close', 'aria-label': __('Close', 'proxyai'),
          onClick: props.onClose,
        }, '×'),
        el('h2', { className: 'pa-card__title pa-modaltitle' },
          props.icon ? el(ChannelIcon, { name: props.icon, size: 22 }) : null,
          props.title),
        props.children));
  }

  /** Field state helper shared by the credential modals. */
  function useValues(initial) {
    var s = useState(initial || {});
    var values = s[0]; var setState = s[1];
    return {
      values: values,
      set: function (key, value) {
        var next = {};
        Object.keys(values).forEach(function (k) { next[k] = values[k]; });
        next[key] = value;
        setState(next);
      },
    };
  }

  function SecretField(props) {
    return el(Field, { label: props.label, hint: props.hint },
      el(TextInput, { type: 'password', value: props.value, onChange: props.onChange }));
  }

  function ModalSave(props) {
    var s1 = useState(null); var err = s1[0]; var setErr = s1[1];
    return el(Fragment, null,
      err ? el(Notice, { kind: 'error' }, err) : null,
      el(SaveButton, {
        state: props.saver.state,
        helpUrl: props.helpUrl,
        onClick: function () {
          setErr(null);
          props.saver.save(props.payload()).catch(function (e) {
            setErr((e && e.message) || __('Could not save. Check the credentials.', 'proxyai'));
          });
        },
      }));
  }

  /** Widget-icon uploader. Posts multipart to bots/{id}/upload (kind=icon)
      through the proxy. */
  function WidgetIcon(props) {
    var s1 = useState(props.url || ''); var url = s1[0]; var setUrl = s1[1];
    var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
    var s3 = useState(null); var err = s3[0]; var setErr = s3[1];
    var fileRef = useRef(null);
    useEffect(function () { props.onChange(url); }, [url]);

    function upload(file) {
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { setErr(__('Icons are limited to 2MB.', 'proxyai')); return; }
      setBusy(true); setErr(null);
      var form = new window.FormData();
      form.append('kind', 'icon');
      form.append('file', file);
      window.fetch(CFG.restUrl + 'proxyai/v1/admin/bots/' + props.botId + '/upload', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'X-WP-Nonce': CFG.restNonce }, body: form,
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (res.ok && res.d && res.d.url) setUrl(res.d.url);
          else setErr(res.d && res.d.error === 'unsupported_type'
            ? __('Use a PNG, JPG, or WebP image.', 'proxyai') : __('Upload failed.', 'proxyai'));
        }, function () { setErr(__('Upload failed.', 'proxyai')); })
        .then(function () { setBusy(false); if (fileRef.current) fileRef.current.value = ''; });
    }

    return el('div', { className: 'pa-field pa-widgeticon' },
      el('span', { className: 'pa-field__label' }, __('Icon', 'proxyai')),
      el('div', { className: 'pa-widgeticon__row' },
        el('span', { className: 'pa-widgeticon__preview' },
          url ? el('img', { src: url, alt: '' }) : el('span', { className: 'pa-widgeticon__ph' }, '🖼')),
        el('input', {
          ref: fileRef, type: 'file', className: 'pa-hidden', accept: 'image/png,image/jpeg,image/webp',
          // Clear the value so re-picking the same file still fires change.
          onChange: function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; upload(f); },
        }),
        el('button', {
          type: 'button', className: 'pa-btn', disabled: busy,
          onClick: function () { if (fileRef.current) fileRef.current.click(); },
        }, busy ? __('Uploading…', 'proxyai') : url ? __('Replace', 'proxyai') : __('Upload', 'proxyai')),
        url ? el('button', {
          type: 'button', className: 'pa-link pa-widgeticon__remove',
          onClick: function () { setUrl(''); },
        }, __('Remove', 'proxyai')) : null),
      err ? el('span', { className: 'pa-field__hint pa-widgeticon__err' }, err) : null);
  }

  function WebChannelModal(props) {
    var init = props.initial || {};
    var s1 = useState(init.domain || ''); var domain = s1[0]; var setDomain = s1[1];
    var s2 = useState((init.starterChips || []).join('\n')); var chips = s2[0]; var setChips = s2[1];
    var s3 = useState(init.iconUrl || ''); var iconUrl = s3[0]; var setIconUrl = s3[1];
    var saver = useSave('web', props.botId);
    return el(ModalShell, { icon: 'web', title: 'Web', onClose: props.onClose },
      el('div', { className: 'pa-webrow' },
        el(Field, {
          label: __('Domain', 'proxyai'),
          hint: __('Sites allowed to embed this bot. Comma-separate for more than one. You can save without a domain, but the widget only accepts messages from whitelisted domains — add every site where the bot will be used.', 'proxyai'),
        }, el(TextInput, { value: domain, onChange: setDomain, placeholder: 'app.example.com' })),
        el(WidgetIcon, { botId: props.botId, url: iconUrl, onChange: setIconUrl })),
      el(Field, {
        label: __('Starter Chips', 'proxyai'),
        hint: __('Quick-tap buttons shown before the first message, one per line — e.g. “Help”, “Pricing”.', 'proxyai'),
      }, el(TextArea, { value: chips, rows: 3, onChange: setChips })),
      el('p', { className: 'pa-card__fine' },
        __('This plugin embeds the widget on your site automatically — no embed code to paste.', 'proxyai')),
      el(ModalSave, {
        saver: saver,
        helpUrl: '/help/integrations/web-connection',
        payload: function () {
          return {
            domain: domain,
            iconUrl: iconUrl,
            starterChips: chips.split('\n').map(function (c) { return c.trim(); }).filter(Boolean),
          };
        },
      }));
  }

  function MetaModal(props) {
    var fp = props.formProps;
    var v = useValues(fp.initialWhatsappMeta || {});
    var saver = useSave('whatsapp', props.botId);
    var connected = v.values.webhookStatus === 'connected';
    return el(ModalShell, { icon: 'whatsapp', title: 'WhatsApp (Meta)', onClose: props.onClose },
      el(OAuthSection, {
        title: __('Connect your WhatsApp number', 'proxyai'),
        subtitle: __('Official Cloud API via Meta’s signup popup — pick or create your business, verify the number, done.', 'proxyai'),
        actionLabel: __('Connect WhatsApp', 'proxyai'),
        enabled: !!(props.oauth && props.oauth.whatsapp),
        next: '/dashboard/bots/' + props.botId + '?connect=whatsapp',
      }),
      el(AdvancedDivider, null),
      el(Field, { label: __('Phone Number ID', 'proxyai') },
        el(TextInput, { value: v.values.phoneNumberId || '', onChange: function (x) { v.set('phoneNumberId', x); } })),
      el(Field, { label: __('WhatsApp Business Account ID', 'proxyai') },
        el(TextInput, { value: v.values.wabaId || '', onChange: function (x) { v.set('wabaId', x); } })),
      el(SecretField, { label: __('Permanent Access Token', 'proxyai'),
        value: v.values.accessToken || '', onChange: function (x) { v.set('accessToken', x); } }),
      el('div', { className: 'pa-webhookstatus' },
        __('Webhook Status', 'proxyai'),
        el('span', { className: 'pa-webhookstatus__pill' + (connected ? ' is-on' : '') },
          connected ? __('CONNECTED', 'proxyai') : __('PENDING', 'proxyai'))),
      el(ModalSave, {
        saver: saver,
        helpUrl: '/help/integrations/whatsapp-connection',
        payload: function () {
          return { mode: 'meta', meta: v.values, bridge: fp.initialWhatsappBridge || {} };
        },
      }));
  }

  function TelegramModal(props) {
    var v = useValues(props.formProps.initialTelegram || {});
    var saver = useSave('telegram', props.botId);
    return el(ModalShell, { icon: 'telegram', title: 'Telegram', onClose: props.onClose },
      !v.values.botToken
        ? el(ConnectSteps, {
            title: __('Create your bot (about 90 seconds)', 'proxyai'),
            ctaLabel: __('Open BotFather', 'proxyai'),
            ctaHref: 'https://t.me/BotFather',
            steps: [
              { text: __('Open BotFather in Telegram and send', 'proxyai'), chip: '/newbot' },
              { text: __('Pick any display name you like.', 'proxyai') },
              { text: __('Then pick a username — Telegram requires it to end in “bot”.', 'proxyai'), note: 'e.g. acme_support_bot' },
              { text: __('BotFather replies with a token — paste it below and Save.', 'proxyai') },
            ],
          })
        : null,
      el(SecretField, {
        label: __('Bot Token', 'proxyai'),
        hint: __('Paste the token BotFather replies with. Saving validates it and registers the webhook automatically — nothing else to configure.', 'proxyai'),
        value: v.values.botToken || '', onChange: function (x) { v.set('botToken', x); },
      }),
      el(Field, { label: __('Bot Username', 'proxyai') },
        el(TextInput, { value: v.values.botUsername || '', onChange: function (x) { v.set('botUsername', x); } })),
      el(Field, { label: __('Privacy Mode', 'proxyai') },
        el(SelectInput, {
          value: v.values.privacyMode || 'commands_only',
          onChange: function (x) { v.set('privacyMode', x); },
          options: [
            { value: 'read_all', label: __('All group messages (requires /setprivacy → Disable in BotFather)', 'proxyai') },
            { value: 'commands_only', label: __('Group Privacy on (Telegram default) — commands, replies and @mentions', 'proxyai') },
          ],
        })),
      el(ToggleRow, {
        label: __('Menu Button', 'proxyai'),
        checked: !!v.values.menuButton,
        onChange: function (x) { v.set('menuButton', x); },
      }),
      el(Field, {
        label: __('Inline Keyboard', 'proxyai'),
        hint: __('One button per line, e.g. “View pricing”.', 'proxyai'),
      }, el(TextArea, {
        value: (v.values.inlineKeyboard || []).join('\n'), rows: 3,
        onChange: function (x) {
          v.set('inlineKeyboard', x.split('\n').map(function (s) { return s.trim(); }).filter(Boolean));
        },
      })),
      el(ModalSave, { saver: saver, helpUrl: '/help/integrations/telegram-connection', payload: function () { return v.values; } }));
  }

  function LineModal(props) {
    var v = useValues(props.formProps.initialLine || {});
    var saver = useSave('line', props.botId);
    return el(ModalShell, { icon: 'line', title: 'Line', onClose: props.onClose },
      !v.values.channelId && !v.values.channelSecret
        ? el(ConnectSteps, {
            title: __('Create your LINE channel (about 3 minutes)', 'proxyai'),
            ctaLabel: __('Open LINE Developers', 'proxyai'),
            ctaHref: 'https://developers.line.biz/console/',
            steps: [
              { text: __('Log in and create a provider', 'proxyai'), note: __('the provider you pick is permanent', 'proxyai') },
              { text: __('Inside it, create a channel of type', 'proxyai'), chip: 'Messaging API' },
              { text: __('Open the Basic settings tab and copy Channel ID and Channel secret below.', 'proxyai') },
              { text: __('Save here — ProxyAI mints the access token and points the webhook at itself.', 'proxyai') },
              { text: __('In LINE Official Account Manager, turn off Auto-reply messages.', 'proxyai'), note: __('otherwise LINE answers before the bot does', 'proxyai') },
            ],
          })
        : null,
      el(Field, {
        label: __('Channel ID', 'proxyai'),
        hint: __('LINE Developers console → your Messaging API channel → Basic settings → Channel ID.', 'proxyai'),
      }, el(TextInput, { value: v.values.channelId || '', onChange: function (x) { v.set('channelId', x); } })),
      el(SecretField, {
        label: __('Channel Secret', 'proxyai'),
        hint: __('Basic settings tab → Channel secret. Used to verify webhook signatures.', 'proxyai'),
        value: v.values.channelSecret || '', onChange: function (x) { v.set('channelSecret', x); },
      }),
      el(SaveNote, { text: __('Saving mints the access token for you, validates it, and points your channel’s webhook at ProxyAI automatically — no token to copy from the console. Keep “Use webhook” ON and turn OFF “Auto-reply messages” in LINE Official Account Manager. When enabling the Messaging API there, the provider you pick is permanent — it cannot be changed later.', 'proxyai') }),
      el(ModalSave, { saver: saver, helpUrl: '/help/integrations/line-connection', payload: function () { return v.values; } }));
  }

  function FacebookModal(props) {
    var v = useValues(props.formProps.initialFacebook || {});
    var saver = useSave('facebook', props.botId);
    return el(ModalShell, { icon: 'messenger', title: 'Messenger', onClose: props.onClose },
      el(OAuthSection, {
        title: __('Connect your Facebook Page', 'proxyai'),
        subtitle: __('One popup — pick the Page, grant access, done. No tokens, no console.', 'proxyai'),
        actionLabel: __('Connect Page', 'proxyai'),
        enabled: !!(props.oauth && props.oauth.facebook),
        next: '/api/bots/' + props.botId + '/facebook/connect',
      }),
      el(AdvancedDivider, { label: __('Advanced — bring your own Meta app', 'proxyai') }),
      el(SecretField, {
        label: __('Page Access Token', 'proxyai'),
        hint: __('Meta Developer Console → your app → Messenger → Settings → generate a token for your Page.', 'proxyai'),
        value: v.values.pageAccessToken || '', onChange: function (x) { v.set('pageAccessToken', x); },
      }),
      el(SecretField, {
        label: __('App Secret', 'proxyai'),
        hint: __('App Settings → Basic → App Secret. Used to verify X-Hub-Signature-256 on every webhook.', 'proxyai'),
        value: v.values.appSecret || '', onChange: function (x) { v.set('appSecret', x); },
      }),
      el(CopyField, { label: __('Webhook callback URL', 'proxyai'), value: props.webhookBase + '/webhook/facebook/' + props.botId }),
      el(CopyField, { label: __('Verify token', 'proxyai'), value: props.botId, secret: true }),
      el(SaveNote, { text: __('Saving validates the token and subscribes your Page to the app’s webhook. The callback URL and verify token above must be entered once in the Meta console (Messenger → Webhooks), subscribed to the “messages” field.', 'proxyai') }),
      el(ModalSave, { saver: saver, helpUrl: '/help/integrations/facebook-connection', payload: function () { return v.values; } }));
  }

  function InstagramModal(props) {
    var v = useValues(props.formProps.initialInstagram || {});
    var saver = useSave('instagram', props.botId);
    return el(ModalShell, { icon: 'instagram', title: 'Instagram', onClose: props.onClose },
      el(OAuthSection, {
        title: __('Connect your Instagram account', 'proxyai'),
        subtitle: __('Log in with Instagram — professional account required, no Facebook Page needed. Then enable message access: IG app → Settings → Messages and story replies → Connected tools.', 'proxyai'),
        actionLabel: __('Connect Instagram', 'proxyai'),
        enabled: !!(props.oauth && props.oauth.instagram),
        next: '/api/bots/' + props.botId + '/instagram/connect',
      }),
      el(AdvancedDivider, { label: __('Advanced — bring your own Meta app', 'proxyai') }),
      el(SecretField, {
        label: __('Page Access Token', 'proxyai'),
        hint: __('Token for the Facebook Page your Instagram professional account is linked to, with instagram_manage_messages granted.', 'proxyai'),
        value: v.values.pageAccessToken || '', onChange: function (x) { v.set('pageAccessToken', x); },
      }),
      el(SecretField, {
        label: __('App Secret', 'proxyai'),
        hint: __('App Settings → Basic → App Secret. Used to verify X-Hub-Signature-256 on every webhook.', 'proxyai'),
        value: v.values.appSecret || '', onChange: function (x) { v.set('appSecret', x); },
      }),
      el(CopyField, { label: __('Webhook callback URL', 'proxyai'), value: props.webhookBase + '/webhook/instagram/' + props.botId }),
      el(CopyField, { label: __('Verify token', 'proxyai'), value: props.botId, secret: true }),
      v.values.username
        ? el('div', { className: 'pa-connectedaccount' },
            el('span', { className: 'pa-switchrow__label' }, __('Connected account', 'proxyai')),
            el('code', null, '@' + v.values.username))
        : null,
      el(SaveNote, { text: __('Saving validates the token, resolves the linked Instagram account and subscribes the Page to the app’s webhook. The callback URL and verify token above must be entered once in the Meta console (Instagram → Webhooks), subscribed to the “messages” field. Your Instagram account must be Professional, linked to the Page, and have “Allow access to messages” enabled in the app settings.', 'proxyai') }),
      el(ModalSave, { saver: saver, helpUrl: '/help/integrations/instagram-connection', payload: function () { return v.values; } }));
  }

  function DiscordModal(props) {
    var v = useValues(props.formProps.initialDiscord || {});
    var saver = useSave('discord', props.botId);
    return el(ModalShell, { icon: 'discord', title: 'Discord', onClose: props.onClose },
      el(OAuthSection, {
        title: __('Add the ProxyAI bot to your server', 'proxyai'),
        subtitle: __('One click — pick your server, authorize, done. Members chat with /ask.', 'proxyai'),
        actionLabel: __('Add to Server', 'proxyai'),
        enabled: !!(props.oauth && props.oauth.discord),
        next: '/api/bots/' + props.botId + '/discord/install',
      }),
      el(AdvancedDivider, { label: __('Advanced — bring your own bot', 'proxyai') }),
      el(SecretField, {
        label: __('Bot Token', 'proxyai'),
        hint: __('Discord Developer Portal → your application → Bot → Reset Token.', 'proxyai'),
        value: v.values.botToken || '', onChange: function (x) { v.set('botToken', x); },
      }),
      el(SecretField, {
        label: __('Public Key', 'proxyai'),
        hint: __('General Information → Public Key. Used to verify the Ed25519 signature on every interaction.', 'proxyai'),
        value: v.values.publicKey || '', onChange: function (x) { v.set('publicKey', x); },
      }),
      el(Field, {
        label: __('Slash Command', 'proxyai'),
        hint: __('Lowercase, no spaces. Defaults to “ask” — members chat with the bot by typing /ask.', 'proxyai'),
      }, el(TextInput, { value: v.values.commandName || '', onChange: function (x) { v.set('commandName', x); } })),
      el(CopyField, { label: __('Interactions endpoint URL', 'proxyai'), value: props.webhookBase + '/webhook/discord/' + props.botId }),
      el(SaveNote, { text: __('Saving validates the token, registers the slash command and sets the interactions endpoint above for you. Discord delivers messages as slash commands, not as plain channel chatter — members reach the bot with /ask in any server or DM where the app is installed.', 'proxyai') }),
      el(ModalSave, { saver: saver, helpUrl: '/help/integrations/discord-connection', payload: function () { return v.values; } }));
  }

  /**
   * Native WhatsApp bridge pairing. The bridge session is pollable through
   * the proxy (GET status+qr / POST start / DELETE unpair); the qr field is
   * a ready data-URL image.
   */
  function BridgeModal(props) {
    var botId = props.botId;
    var s1 = useState('none'); var state = s1[0]; var setState = s1[1];
    var s2 = useState(null); var qr = s2[0]; var setQr = s2[1];
    var s3 = useState(null); var phone = s3[0]; var setPhone = s3[1];
    var s4 = useState(null); var error = s4[0]; var setError = s4[1];
    var s5 = useState(false); var polling = s5[0]; var setPolling = s5[1];

    var poll = useCallback(function () {
      return api('bots/' + botId + '/whatsapp/session').then(function (s) {
        setState(s.state || 'none');
        setQr(s.qr || null);
        setPhone(s.phone || null);
        setError(null);
        // Poll while mid-pairing (even one started elsewhere); stop once
        // the session settles.
        if (s.state === 'connecting' || s.state === 'waiting_qr') setPolling(true);
        else if (s.state === 'connected' || s.state === 'logged_out') setPolling(false);
      }, function () { setError(__('Bridge unreachable.', 'proxyai')); setPolling(false); });
    }, [botId]);

    // Once on open, then every 2s while pairing is active, skipping
    // overlapping ticks and hidden tabs.
    useEffect(function () { poll(); }, [poll]);
    useEffect(function () {
      if (!polling) return undefined;
      var inFlight = false;
      function tick() {
        if (document.visibilityState !== 'visible' || inFlight) return;
        inFlight = true;
        poll().then(function () { inFlight = false; }, function () { inFlight = false; });
      }
      var timer = window.setInterval(tick, 2000);
      return function () { window.clearInterval(timer); };
    }, [polling, poll]);

    function connect() {
      setError(null);
      setState('connecting');
      api('bots/' + botId + '/whatsapp/session', { method: 'POST' }).then(
        // Fetch immediately so the QR appears before the first interval tick.
        function () { setPolling(true); poll(); },
        function () { setState('none'); setError(__('Could not start pairing — bridge unreachable.', 'proxyai')); });
    }
    function unpair() {
      api('bots/' + botId + '/whatsapp/session', { method: 'DELETE' }).then(function () {}, function () {});
      setState('none'); setQr(null); setPhone(null); setPolling(false);
    }

    var placeholder =
      state === 'connected' ? __('Connected', 'proxyai') + (phone ? ' as +' + phone : '')
      : state === 'connecting' ? __('Starting session…', 'proxyai')
      : state === 'logged_out' ? __('Logged out. Connect to pair again.', 'proxyai')
      : __('Click Connect, then scan the QR with WhatsApp → Linked devices.', 'proxyai');

    return el(ModalShell, { icon: 'whatsapp', title: 'WhatsApp (Bridge)', onClose: props.onClose },
      el('p', { className: 'pa-card__sub' },
        __('Pairing scans a QR code with the phone that owns the WhatsApp number.', 'proxyai')),
      el('div', { className: 'pa-bridge' },
        state === 'waiting_qr' && qr
          ? el('img', { className: 'pa-bridge__qr', src: qr, alt: __('WhatsApp pairing QR code', 'proxyai') })
          : el('div', { className: 'pa-bridge__ph' }, placeholder),
        el('div', { className: 'pa-bridge__actions' },
          state !== 'connected'
            ? el(Button, { variant: 'primary', onClick: connect },
                state === 'waiting_qr' ? __('Restart Pairing', 'proxyai') : __('Connect', 'proxyai'))
            : null,
          (state === 'connected' || state === 'waiting_qr')
            ? el('button', { type: 'button', className: 'pa-bridge__unpair', onClick: unpair }, __('Unpair Device', 'proxyai'))
            : null),
        error ? el('span', { className: 'pa-bridge__err' }, error) : null),
      el('p', { className: 'pa-bridge__warn' },
        __('Unofficial WhatsApp integration — device pairing may be revoked by WhatsApp at any time.', 'proxyai')));
  }

  // Channel-card link glyph, mirroring the web gallery's LinkStatusIcon
  // (connected = green chain, else broken chain).
  var CHAIN_GLYPH = {
    connected: 'm180.575 150.405l15.085 15.085c36.49-36.49 92.839-41.015 134.255-13.577l85.77-85.769l30.17 30.17l-85.769 85.771C387.525 223.501 383 279.85 346.51 316.34l15.085 15.085l-30.17 30.17l-15.085-15.085c-36.49 36.49-92.84 41.015-134.255 13.576l-85.771 85.77l-30.17-30.17l85.77-85.771C124.474 288.499 129 232.15 165.49 195.66l-15.085-15.085zm15.085 75.425c-24.993 24.994-24.993 65.516 0 90.51c24.101 24.1 62.642 24.961 87.774 2.582l2.736-2.582zm30.17-30.17l90.51 90.51c24.993-24.994 24.993-65.516 0-90.51c-24.101-24.1-62.642-24.962-87.774-2.582z',
    disconnected: 'm109.72 221.26l37.711 37.712l25.065-25.064l30.17 30.17l-25.065 25.064l45.255 45.255l25.065-25.064l30.17 30.17l-25.065 25.064l37.713 37.712l-30.17 30.17l-15.085-15.085c-36.49 36.49-92.839 41.015-134.255 13.577l-36.25 36.247l-30.169-30.17l36.248-36.249c-27.438-41.416-22.913-97.765 13.577-134.255L79.55 251.43zM89.75 59.58l362.668 362.668l-30.17 30.17L59.58 89.75zm35.055 237.104c-24.994 24.994-24.994 65.516 0 90.51c24.1 24.1 62.641 24.962 87.773 2.582l2.736-2.582zM437.019 44.81l30.17 30.17l-46.915 46.916c27.438 41.416 22.913 97.765-13.577 134.255l15.085 15.085l-30.17 30.17l-181.02-181.02l30.17-30.17l15.086 15.085c36.49-36.49 92.839-41.015 134.254-13.576zm-148.266 88.079l-2.735 2.582l89.377 89.377c17.735-26.918 22.652-67.857 1.132-89.377c-24.1-24.1-62.641-24.961-87.774-2.582',
  };
  function LinkStatus(props) {
    if (!props.status) return null;
    var connected = props.status === 'connected';
    return el('span', {
      className: 'pa-linkstatus' + (connected ? ' is-connected' : ' is-off'),
      role: 'img',
      'aria-label': connected ? __('Connected', 'proxyai') : __('Not connecting', 'proxyai'),
      title: connected ? __('Connected', 'proxyai') : __('Not connecting', 'proxyai'),
    }, el('svg', { width: 16, height: 16, viewBox: '0 0 512 512', fill: 'currentColor', 'aria-hidden': 'true' },
      el('path', { fillRule: 'evenodd', d: CHAIN_GLYPH[connected ? 'connected' : 'disconnected'] })));
  }

  // Config section each card's Reset clears. Bridge is special (unpair, not clear).
  var CHANNEL_SECTION = {
    web: 'web', whatsapp: 'whatsapp', telegram: 'telegram', line: 'line',
    facebook: 'facebook', instagram: 'instagram', discord: 'discord',
  };

  /** The ⋯ overflow menu on a channel card: Reset / Recheck / Disable. */
  function CardMenu(props) {
    var s1 = useState(false); var open = s1[0]; var setOpen = s1[1];
    var ref = useRef(null);
    useEffect(function () {
      if (!open) return undefined;
      function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
      document.addEventListener('mousedown', onDoc);
      return function () { document.removeEventListener('mousedown', onDoc); };
    }, [open]);
    function pick(fn) { return function () { setOpen(false); fn(); }; }
    return el('span', { className: 'pa-cardmenu', ref: ref },
      el('button', {
        type: 'button', className: 'pa-cardmenu__trigger', 'aria-label': __('Options', 'proxyai'),
        onClick: function () { setOpen(!open); },
      }, '⋯'),
      open ? el('span', { className: 'pa-cardmenu__list' },
        el('button', { type: 'button', className: 'pa-cardmenu__item', onClick: pick(props.onReset) }, __('Reset', 'proxyai')),
        el('button', { type: 'button', className: 'pa-cardmenu__item', onClick: pick(props.onRecheck) }, __('Recheck', 'proxyai')),
        el('button', { type: 'button', className: 'pa-cardmenu__item pa-cardmenu__item--danger', onClick: pick(props.onDisable) }, __('Disable', 'proxyai'))) : null);
  }

  function ChannelsPane(props) {
    var fp = props.formProps;
    var s1 = useState(null); var open = s1[0]; var setOpen = s1[1];
    var s2 = useState({}); var statusMap = s2[0]; var setStatusMap = s2[1];
    var s3 = useState(null); var note = s3[0]; var setNote = s3[1];

    var cards = [
      { key: 'web', icon: 'web', name: 'Web', description: __('Embed the chat widget on your own website', 'proxyai'), action: __('Configure', 'proxyai'), configured: true },
      { key: 'whatsapp', icon: 'whatsapp', name: 'WhatsApp (Meta)', description: __('Official WhatsApp via the Meta Cloud API', 'proxyai'), action: __('Authorize', 'proxyai'), configured: !!(fp.initialWhatsappMeta && fp.initialWhatsappMeta.phoneNumberId) },
      { key: 'bridge', icon: 'whatsapp', name: 'WhatsApp (Bridge)', description: __('Pair a WhatsApp device by scanning a QR code', 'proxyai'), action: __('Pair', 'proxyai'), configured: !!(fp.initialWhatsappBridge && fp.initialWhatsappBridge.paired) },
      { key: 'telegram', icon: 'telegram', name: 'Telegram', description: __('A bot that answers Telegram chats and groups', 'proxyai'), action: __('Configure', 'proxyai'), configured: !!(fp.initialTelegram && fp.initialTelegram.botToken) },
      { key: 'line', icon: 'line', name: 'Line', description: __('Connect a LINE Official Account webhook', 'proxyai'), action: __('Configure', 'proxyai'), configured: !!(fp.initialLine && fp.initialLine.channelId) },
      { key: 'facebook', icon: 'messenger', name: 'Messenger', description: __('Answer your Facebook Page’s messages', 'proxyai'), action: __('Authorize', 'proxyai'), configured: !!(fp.initialFacebook && fp.initialFacebook.pageAccessToken) },
      { key: 'instagram', icon: 'instagram', name: 'Instagram', description: __('Reply to DMs on your professional account', 'proxyai'), action: __('Authorize', 'proxyai'), configured: !!(fp.initialInstagram && fp.initialInstagram.pageAccessToken) },
      { key: 'discord', icon: 'discord', name: 'Discord', description: __('A slash command members can use in any server', 'proxyai'), action: __('Authorize', 'proxyai'), configured: !!(fp.initialDiscord && fp.initialDiscord.botToken) },
    ];

    var modalProps = {
      botId: props.botId,
      formProps: fp,
      oauth: props.oauth,
      webhookBase: props.webhookBase,
      onClose: function () { setOpen(null); },
    };
    var modals = {
      web: WebChannelModal,
      whatsapp: MetaModal,
      bridge: BridgeModal,
      telegram: TelegramModal,
      line: LineModal,
      facebook: FacebookModal,
      instagram: InstagramModal,
      discord: DiscordModal,
    };
    var OpenModal = open ? modals[open] : null;
    var initialFor = {
      web: fp.initialWeb || {},
    };

    // Link-glyph status: the card's stored config unless a Recheck refined it.
    function statusOfCard(c) {
      if (Object.prototype.hasOwnProperty.call(statusMap, c.key)) return statusMap[c.key];
      return c.configured ? 'connected' : 'disconnected';
    }

    // Recheck probes every channel via the shared channel-health route and
    // reports what the providers actually said.
    function recheck() {
      setNote({ kind: 'info', text: __('Rechecking…', 'proxyai') });
      api('bots/' + props.botId + '/channel-health').then(function (health) {
        var next = {};
        Object.keys(health || {}).forEach(function (k) {
          var s = health[k] && health[k].status;
          next[k] = s === 'connected' ? 'connected' : (s === 'not_configured' ? null : 'disconnected');
        });
        setStatusMap(next);
        setNote({ kind: 'success', text: __('Connection status updated.', 'proxyai') });
      }, function () { setNote({ kind: 'error', text: __('Could not reach the channels to recheck.', 'proxyai') }); });
    }

    function resetCard(c) {
      if (c.key === 'bridge') {
        setNote({ kind: 'info', text: __('Open Pair and use Unpair Device — resetting the bridge disconnects the linked phone.', 'proxyai') });
        return;
      }
      var section = CHANNEL_SECTION[c.key];
      if (!section) return;
      api('bots/' + props.botId + '/config', { method: 'PATCH', data: { section: section, data: {} } }).then(function () {
        setStatusMap(function (m) { var n = {}; Object.keys(m).forEach(function (k) { n[k] = m[k]; }); n[c.key] = 'disconnected'; return n; });
        setNote({ kind: 'success', text: __('Cleared. Configure to add new credentials and save.', 'proxyai') });
      }, function () { setNote({ kind: 'error', text: __('Could not reset. Try again.', 'proxyai') }); });
    }

    function disableCard() {
      setNote({ kind: 'info', text: __('Per-channel disable isn’t available yet.', 'proxyai') });
    }

    return el(
      Fragment,
      null,
      el('p', { className: 'pa-pane__lede' },
        __('Where your bot talks to customers. Each channel is configured separately.', 'proxyai')),
      note ? el(Notice, { kind: note.kind }, note.text) : null,
      el('div', { className: 'pa-channelgrid' },
        cards.map(function (c) {
          return el('div', { key: c.key, className: 'pa-channelcard' },
            el('span', { className: 'pa-channelcard__top' },
              el(ChannelIcon, { name: c.icon }),
              el('span', { className: 'pa-channelcard__name' }, c.name),
              el(CardMenu, {
                onReset: function () { resetCard(c); },
                onRecheck: recheck,
                onDisable: disableCard,
              })),
            el('p', { className: 'pa-channelcard__desc' }, c.description),
            el('span', { className: 'pa-channelcard__foot' },
              el(LinkStatus, { status: statusOfCard(c) }),
              el(Button, {
                onClick: function () { setOpen(c.key); },
              }, c.action)));
        })),
      OpenModal
        ? el(OpenModal, Object.assign({ initial: initialFor[open] }, modalProps))
        : null
    );
  }

  /**
   * Store actions tab, mirroring the embedded form's "extra" tab: helpdesk
   * and hand-off switches (saved together), then the commerce panel.
   */
  function ExtraPane(props) {
    var fp = props.formProps;
    var owned = fp.purchasedAddons || {};
    var initHelpdesk = fp.initialHelpdesk || {};
    var initHandoff = fp.initialHandoff || {};
    var s1 = useState({
      open_tickets: initHelpdesk.open_tickets !== false,
      email_capture: initHelpdesk.email_capture !== false,
      order_lookup: initHelpdesk.order_lookup !== false,
    });
    var helpdesk = s1[0]; var setHelpdesk = s1[1];
    var s2 = useState(initHandoff.enabled != null ? !!initHandoff.enabled : initHandoff.ownerType === 'human');
    var handoffOn = s2[0]; var setHandoffOn = s2[1];
    var s3 = useState(false); var dirty = s3[0]; var setDirty = s3[1];
    var s4 = useState('idle'); var saveState = s4[0]; var setSaveState = s4[1];

    function setDeskAction(key, value) {
      var next = {};
      Object.keys(helpdesk).forEach(function (k) { next[k] = helpdesk[k]; });
      next[key] = value;
      setHelpdesk(next);
      setDirty(true);
    }

    function saveActions() {
      setSaveState('saving');
      var writes = [];
      if (owned.helpdesk) {
        writes.push(api('bots/' + props.botId + '/config', {
          method: 'PATCH',
          data: {
            section: 'helpdesk',
            data: {
              connections: initHelpdesk.connections || [],
              open_tickets: helpdesk.open_tickets,
              email_capture: helpdesk.email_capture,
              order_lookup: helpdesk.order_lookup,
              ticket_categories: initHelpdesk.ticket_categories || [],
              auto_archive_days: initHelpdesk.auto_archive_days || 0,
              auto_resolve_pending_days: initHelpdesk.auto_resolve_pending_days || 0,
            },
          },
        }));
      }
      if (owned.handoff) {
        var handoffData = {};
        Object.keys(initHandoff).forEach(function (k) { handoffData[k] = initHandoff[k]; });
        handoffData.enabled = handoffOn;
        handoffData.ownerType = 'bot';
        writes.push(api('bots/' + props.botId + '/config', {
          method: 'PATCH',
          data: { section: 'handoff', data: handoffData },
        }));
      }
      Promise.all(writes).then(
        function () {
          setDirty(false);
          setSaveState('saved');
          window.setTimeout(function () { setSaveState('idle'); }, 2500);
        },
        function () { setSaveState('error'); }
      );
    }

    return el(
      Fragment,
      null,
      el('section', { className: 'pa-actioncard' },
        el('h2', { className: 'pa-card__title' }, __('Helpdesk actions', 'proxyai')),
        el('p', { className: 'pa-card__sub' },
          owned.helpdesk
            ? __('What the helpdesk add-on may do beyond filing tickets.', 'proxyai')
            : __('What the helpdesk add-on may do beyond filing tickets. Included with the Helpdesk add-on.', 'proxyai')),
        el(ToggleRow, {
          label: __('Open tickets', 'proxyai'),
          description: __('The bot files a support ticket from chat when a customer’s problem needs your team to act.', 'proxyai'),
          checked: owned.helpdesk ? helpdesk.open_tickets : false,
          disabled: !owned.helpdesk,
          onChange: function (v) { setDeskAction('open_tickets', v); },
        }),
        el(ToggleRow, {
          label: __('Attach customer email automatically', 'proxyai'),
          description: __('A signed-in shopper’s account email is used for their ticket instead of the bot asking for one.', 'proxyai'),
          checked: owned.helpdesk ? helpdesk.email_capture : false,
          disabled: !owned.helpdesk,
          onChange: function (v) { setDeskAction('email_capture', v); },
        }),
        el(ToggleRow, {
          label: __('Order lookup', 'proxyai'),
          description: __('Let signed-in shoppers ask the bot about their own order’s status and tracking.', 'proxyai'),
          checked: owned.helpdesk ? helpdesk.order_lookup : false,
          disabled: !owned.helpdesk,
          onChange: function (v) { setDeskAction('order_lookup', v); },
        })),
      el('section', { className: 'pa-actioncard' },
        el('h2', { className: 'pa-card__title' }, __('Handoff action', 'proxyai')),
        el('p', { className: 'pa-card__sub' },
          owned.handoff
            ? __('Route conversations to a human agent.', 'proxyai')
            : __('Route conversations to a human agent. Included with the Human Hand-off add-on.', 'proxyai')),
        el(ToggleRow, {
          label: __('Enable human hand-off', 'proxyai'),
          description: __('Customers asking for a human (“talk to a human”, “live agent”…) are transferred to your agent inbox.', 'proxyai'),
          checked: owned.handoff ? handoffOn : false,
          disabled: !owned.handoff,
          onChange: function (v) { setHandoffOn(v); setDirty(true); },
        })),
      dirty && saveState !== 'saving'
        ? el('p', { className: 'pa-unsaved' }, __('Unsaved changes — press Save to apply them.', 'proxyai'))
        : null,
      el(SaveButton, { state: saveState, onClick: saveActions }),
      props.hasStoreActions ? el(StoreActionsPane, null) : null
    );
  }

  /** Store actions — the commerce switches, written through the proxy. */
  function StoreActionsPane() {
    var s1 = useState(null); var data = s1[0]; var setData = s1[1];
    var s2 = useState(false); var failed = s2[0]; var setFailed = s2[1];

    useEffect(function () {
      api('wordpress/commerce').then(setData, function () { setFailed(true); });
    }, []);

    function save(patch) {
      var previous = data;
      var optimistic = { settings: {}, serverCartSupported: data.serverCartSupported };
      Object.keys(data.settings).forEach(function (k) { optimistic.settings[k] = data.settings[k]; });
      Object.keys(patch).forEach(function (k) { optimistic.settings[k] = patch[k]; });
      setData(optimistic);
      api('wordpress/commerce', { method: 'PATCH', data: patch }).then(
        function (res) {
          setData({ settings: res.settings, serverCartSupported: data.serverCartSupported });
        },
        function () { setData(previous); }
      );
    }

    if (failed) {
      return el('p', { className: 'pa-card__sub' },
        __('Store actions need the WooCommerce Store add-on — see the Add-ons tab.', 'proxyai'));
    }
    if (!data) return el(Spinner, null);
    var s = data.settings;

    return el(
      Fragment,
      null,
      el('h3', { className: 'pa-pane__subhead' }, __('Cart actions', 'proxyai')),
      el('p', { className: 'pa-card__sub' },
        __('Whether the bot may build a shopper’s order during the conversation. With these off it still answers questions about your products, prices, stock and policies.', 'proxyai')),
      el(ToggleRow, {
        label: __('Cart changes on your website', 'proxyai'),
        description: __('The bot changes the cart the shopper is looking at, in their own browser.', 'proxyai'),
        checked: !!s.browser_cart,
        onChange: function (v) { save({ browser_cart: v }); },
      }),
      data.serverCartSupported
        ? el(ToggleRow, {
            label: __('Checkout links on chat channels', 'proxyai'),
            description: __('WhatsApp, LINE and others: the bot gathers the order, then sends a link that fills the cart and opens checkout.', 'proxyai'),
            checked: !!s.server_cart,
            onChange: function (v) { save({ server_cart: v }); },
          })
        : el('p', { className: 'pa-card__fine' },
            __('On WhatsApp, LINE and other chat channels the bot answers product questions but hands over nothing. Filling a cart from a link needs WooCommerce 10.0 or newer and permalinks set to anything other than “Plain”. Fix either and this turns on by itself.', 'proxyai')),
      el('h3', { className: 'pa-pane__subhead' }, __('Limits', 'proxyai')),
      el('div', { className: 'pa-switchrow' },
        el('span', { className: 'pa-switchrow__text' },
          el('span', { className: 'pa-switchrow__label' }, __('Most of one item per request', 'proxyai')),
          el('span', { className: 'pa-switchrow__sub' },
            __('The bot is told this limit, so it declines politely instead of failing.', 'proxyai'))),
        el('input', {
          type: 'number', className: 'pa-input pa-qty', min: 1, max: 999,
          value: s.max_quantity || 100,
          onChange: function (e) {
            var n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 1 && n <= 999) save({ max_quantity: n });
          },
        })),
      el(ToggleRow, {
        label: __('Hand over a checkout link', 'proxyai'),
        description: __('Off: the bot builds the cart but leaves the shopper to check out themselves.', 'proxyai'),
        checked: !!s.checkout_link,
        onChange: function (v) { save({ checkout_link: v }); },
      })
    );
  }

  function ConfigTab(props) {
    var fp = props.formProps;
    var s1 = useState('identity'); var sub = s1[0]; var setSub = s1[1];
    if (!fp) return el(Spinner, null);
    var owned = fp.purchasedAddons || {};

    var subTabs = [{ key: 'identity', label: __('Bot Identity', 'proxyai') }];
    if (owned.rag) subTabs.push({ key: 'knowledge', label: __('Bot Knowledge', 'proxyai') });
    if (owned.abuseGuard) subTabs.push({ key: 'abuseGuard', label: __('Abuse Guard', 'proxyai') });
    if (owned.handoff) subTabs.push({ key: 'handoff', label: __('Hand-off', 'proxyai') });
    if (owned.helpdesk) subTabs.push({ key: 'helpdesk', label: __('Helpdesk', 'proxyai') });
    subTabs.push({ key: 'channels', label: __('Channels', 'proxyai') });
    // Shown for a real store, or when owning either add-on whose top-level
    // switch lives here.
    if (props.hasStoreActions || owned.helpdesk || owned.handoff) {
      subTabs.push({ key: 'extra', label: __('Store actions', 'proxyai') });
    }

    var body;
    switch (sub) {
      case 'knowledge': body = el(KnowledgePane, { botId: props.botId, formProps: fp }); break;
      case 'abuseGuard': body = el(AbusePane, { botId: props.botId, formProps: fp }); break;
      case 'handoff': body = el(HandoffPane, { botId: props.botId, formProps: fp, onNavigate: props.onNavigate }); break;
      case 'helpdesk': body = el(HelpdeskPane, { botId: props.botId, formProps: fp, onNavigate: props.onNavigate }); break;
      case 'channels': body = el(ChannelsPane, {
        botId: props.botId, formProps: fp,
        oauth: props.oauth, webhookBase: props.webhookBase,
      }); break;
      case 'extra': body = el(ExtraPane, {
        botId: props.botId, formProps: fp, hasStoreActions: props.hasStoreActions,
      }); break;
      default: body = el(IdentityPane, { botId: props.botId, formProps: fp, onNavigate: props.onNavigate });
    }

    return el(
      'div',
      { className: 'pa-config' },
      el('nav', { className: 'pa-subtabs' },
        subTabs.map(function (t) {
          // The label stays the accessible name; narrow screens swap in the
          // glyph visually, not structurally.
          return el('button', {
            key: t.key, type: 'button',
            className: 'pa-subtab' + (sub === t.key ? ' is-active' : ''),
            'aria-label': t.label,
            title: t.label,
            onClick: function () { setSub(t.key); },
          },
            el('span', { className: 'pa-subtab__icon' }, tabIcon(t.key)),
            el('span', { className: 'pa-subtab__label' }, t.label));
        })),
      el('div', { className: 'pa-config__body' }, body)
    );
  }

  // ------------------------------------------------------------------
  // Inbox tab (handoff conversations)
  // ------------------------------------------------------------------

  function useHandoffList(botId, enabled) {
    var s1 = useState(null); var data = s1[0]; var setData = s1[1];
    var s2 = useState(false); var failed = s2[0]; var setFailed = s2[1];

    var load = useCallback(function () {
      if (!enabled) return Promise.resolve();
      return api('bots/' + botId + '/handoff?view=list').then(
        function (res) { setData(res); setFailed(false); },
        function () { setFailed(true); }
      );
    }, [botId, enabled]);

    useEffect(function () {
      if (!enabled) return undefined;
      load();
      // Polling, not SSE: the PHP proxy buffers streams. 10s is fresh enough.
      var timer = window.setInterval(load, 10000);
      return function () { window.clearInterval(timer); };
    }, [load, enabled]);

    return { data: data, failed: failed, reload: load };
  }

  // Channel display names, matching the hosted dashboard (aliases included).
  var CHANNEL_LABELS = {
    web: 'Web', whatsapp: 'WhatsApp', whatsapp_bridge: 'WhatsApp', whatsapp_meta: 'WhatsApp',
    telegram: 'Telegram', line: 'LINE', facebook: 'Messenger', messenger: 'Messenger',
    instagram: 'Instagram', discord: 'Discord',
  };
  function channelLabel(channel) {
    var key = String(channel || '').toLowerCase();
    return CHANNEL_LABELS[key] || channel || __('Unknown', 'proxyai');
  }

  // "3m" / "2h" / "4d" — how long the customer has been waiting.
  function waitedFor(since) {
    var mins = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
    if (mins < 1) return __('just now', 'proxyai');
    if (mins < 60) return mins + 'm';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h';
    return Math.floor(hours / 24) + 'd';
  }

  /** Stored customer photos persist as [image:<object key>] markers. */
  var IMAGE_MARKER = /\[image:([^\]]+)\]/;

  // Attachments render straight into src/href, so only data: URLs pass —
  // a poisoned row must not become a live link.
  function safeAttachment(a) { return a && typeof a.dataUrl === 'string' && a.dataUrl.indexOf('data:') === 0; }

  /**
   * Attachment bytes stream through their own PHP route. The object key
   * rides as a query param, not a path segment — hosts with
   * AllowEncodedSlashes Off would 404 an encoded %2F in the path.
   */
  function attachmentUrl(key) {
    return CFG.restUrl + 'proxyai/v1/attachment?key=' + encodeURIComponent(key) +
      '&_wpnonce=' + encodeURIComponent(CFG.restNonce);
  }

  var INBOX_ICON_PATHS = {
    refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
    archive: ['M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4'],
    restore: ['M4 8v11a2 2 0 0 0 2 2h2', 'M20 8v11a2 2 0 0 1-2 2h-2', 'm9 15 3-3 3 3', 'M12 12v9'],
    trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
    bot: ['M12 8V4H8', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'],
    user: ['M20 21a8 8 0 0 0-16 0'],
    paperclip: ['m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48'],
    sparkles: ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'],
    send: ['M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z', 'm21.854 2.147-10.94 10.939'],
  };

  function InboxIcon(props) {
    var children = (INBOX_ICON_PATHS[props.name] || []).map(function (d, i) {
      return el('path', { key: i, d: d });
    });
    if (props.name === 'archive' || props.name === 'restore') {
      children.push(el('rect', { key: 'r', x: 2, y: 3, width: 20, height: 5, rx: 1 }));
    }
    if (props.name === 'bot') children.push(el('rect', { key: 'r', x: 4, y: 8, width: 16, height: 12, rx: 2 }));
    if (props.name === 'user') children.push(el('circle', { key: 'c', cx: 12, cy: 8, r: 5 }));
    return el('svg', {
      width: props.size || 14, height: props.size || 14, viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', strokeWidth: 2,
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
    }, children);
  }

  /**
   * Transcript pane, mirroring AgentInboxClient's right column. Polls every
   * 3s while visible; polling is the WebSocket's designed fallback, and the
   * PHP proxy cannot hold a socket open.
   */
  function Thread(props) {
    var botId = props.botId;
    var conversationId = props.conversationId;
    var s1 = useState([]); var messages = s1[0]; var setMessages = s1[1];
    var s2 = useState(null); var ownership = s2[0]; var setOwnership = s2[1];
    var s3 = useState(''); var draft = s3[0]; var setDraft = s3[1];
    var s4 = useState(false); var sending = s4[0]; var setSending = s4[1];
    var s5 = useState(false); var suggesting = s5[0]; var setSuggesting = s5[1];
    var s6 = useState(false); var uploading = s6[0]; var setUploading = s6[1];
    var s7 = useState(null); var error = s7[0]; var setError = s7[1];
    var s8 = useState(false); var loaded = s8[0]; var setLoaded = s8[1];
    var bottomRef = useRef(null);
    var fileRef = useRef(null);

    var load = useCallback(function () {
      return api('bots/' + botId + '/handoff?view=messages&conversationId=' + encodeURIComponent(conversationId))
        .then(function (data) {
          setMessages(data.messages || []);
          setOwnership(data.ownership || null);
          setLoaded(true);
        }, function () {});
    }, [botId, conversationId]);

    useEffect(function () {
      var inFlight = false;
      function tick() {
        if (document.visibilityState !== 'visible' || inFlight) return;
        inFlight = true;
        load().then(function () { inFlight = false; }, function () { inFlight = false; });
      }
      var first = window.setTimeout(tick, 0);
      var timer = window.setInterval(tick, 3000);
      return function () { window.clearTimeout(first); window.clearInterval(timer); };
    }, [load]);

    useEffect(function () {
      if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages.length]);

    function act(action, extra) {
      var body = { action: action, conversationId: conversationId };
      Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
      return api('bots/' + botId + '/handoff', { method: 'POST', data: body });
    }

    function send() {
      if (!draft.trim() || sending) return;
      setSending(true);
      setError(null);
      act('reply', { text: draft.trim() }).then(function () {
        setDraft('');
        return load();
      }, function (err) {
        // Show the runtime's own message. The 24-hour-window rejection is an
        // expected state — its sentence stands alone, without status noise.
        var detail = err && err.detail ? String(err.detail).trim() : '';
        if (detail && detail.indexOf('24-hour window') !== -1) setError(detail);
        else if (detail) setError(__('Send failed', 'proxyai') + ' (' + (err.status || '') + '): ' + detail);
        else setError(__('Send failed — check the channel connection.', 'proxyai'));
      }).then(function () { setSending(false); });
    }

    function suggest() {
      if (suggesting) return;
      setSuggesting(true);
      setError(null);
      act('suggest').then(function (res) {
        if (res && res.text) setDraft(res.text);
      }, function (err) {
        setError(statusOf(err) === 402 || errorOf(err) === 'insufficient_credits'
          ? __('Out of credits — top up to use suggested replies.', 'proxyai')
          : __('Could not draft a reply. Try again.', 'proxyai'));
      }).then(function () { setSuggesting(false); });
    }

    function uploadFile(file) {
      if (uploading) return;
      setUploading(true);
      setError(null);
      var form = new FormData();
      form.append('conversationId', conversationId);
      form.append('file', file);
      // Plain fetch: apiFetch would JSON-encode the multipart body.
      window.fetch(CFG.restUrl + 'proxyai/v1/admin/bots/' + botId + '/handoff/attachments', {
        method: 'POST',
        headers: { 'X-WP-Nonce': CFG.restNonce },
        credentials: 'same-origin',
        body: form,
      }).then(function (res) {
        if (!res.ok) throw new Error('upload');
        return res.json();
      }).then(function (uploaded) {
        // The file lives in R2; the message records that it was sent.
        return act('reply', { text: '📎 ' + __('Sent a file:', 'proxyai') + ' ' + uploaded.name }).then(load, function () {
          // Bytes stored but the customer was never notified — say so.
          setError(__('File stored, but the message announcing it failed to send. Reply manually.', 'proxyai'));
        });
      }).catch(function () {
        setError(__('Upload failed. Files up to 3 MB: png, jpg, pdf, docx, txt, mp4, mov.', 'proxyai'));
      }).then(function () {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
      });
    }

    var humanOwned = ownership && ownership.ownerType === 'human';
    var heldElsewhere = ownership && ownership.heldByOtherDevice;

    function bubble(m, i) {
      var match = typeof m.content === 'string' ? m.content.match(IMAGE_MARKER) : null;
      var imageKey = match ? match[1] : null;
      var text = imageKey ? m.content.replace(IMAGE_MARKER, '').trim() : m.content;
      var kids = [];
      if (m.role !== 'user') {
        kids.push(el('span', { key: 'w', className: 'pa-bubble__who' },
          m.role === 'agent' ? __('You', 'proxyai') : __('Bot', 'proxyai')));
      }
      if (imageKey) {
        kids.push(el('img', {
          key: 'img', className: 'pa-bubble__photo', alt: __('Customer photo', 'proxyai'),
          src: attachmentUrl(imageKey),
        }));
      }
      if (text || !imageKey) kids.push(el('span', { key: 't', className: 'pa-bubble__text' }, text || m.content));
      (imageKey ? [] : (m.attachments || [])).filter(safeAttachment).forEach(function (a, j) {
        if (String(a.contentType || '').indexOf('image/') === 0) {
          kids.push(el('img', { key: 'a' + j, className: 'pa-bubble__photo', src: a.dataUrl, alt: a.name || __('Attachment', 'proxyai') }));
        } else {
          kids.push(el('a', {
            key: 'a' + j, className: 'pa-bubble__file', href: a.dataUrl,
            download: a.name || 'attachment',
          }, a.name || __('Download attachment', 'proxyai')));
        }
      });
      return el('div', {
        key: i,
        className: 'pa-bubble pa-bubble--' + (m.role === 'user' ? 'user' : m.role === 'agent' ? 'agent' : 'assistant'),
      }, kids);
    }

    return el(
      'div',
      { className: 'pa-thread' },
      el('div', { className: 'pa-thread__bar' },
        props.onBack ? el(Button, { onClick: props.onBack }, '← ' + __('Back', 'proxyai')) : null,
        el('span', { className: 'pa-thread__who' },
          humanOwned
            ? (heldElsewhere
                ? __("An agent's phone holds this conversation", 'proxyai')
                : __('You own this conversation', 'proxyai'))
            : __('Bot is answering', 'proxyai')),
        el('span', { className: 'pa-thread__actions' },
          humanOwned
            ? el(Button, {
                onClick: function () { act('release').then(load).then(props.onChanged); },
              }, el(InboxIcon, { name: 'bot' }), ' ', __('Return to bot', 'proxyai'))
            : el(Button, {
                onClick: function () { act('takeover').then(load).then(props.onChanged); },
              }, el(InboxIcon, { name: 'user' }), ' ', __('Take over', 'proxyai')))),
      ownership && ownership.summary
        ? el('div', { className: 'pa-thread__summary' },
            el('span', { className: 'pa-thread__summarytag' }, __('AI briefing', 'proxyai')),
            el('p', { className: 'pa-thread__summarytext' }, ownership.summary))
        : null,
      el('div', { className: 'pa-thread__scroll' },
        !loaded ? el(Spinner, null) : messages.map(bubble),
        el('div', { ref: bottomRef })),
      el('div', { className: 'pa-thread__composer' },
        error ? el('p', { className: 'pa-thread__error' }, error) : null,
        el('div', { className: 'pa-thread__composerrow' },
          el('input', {
            ref: fileRef, type: 'file', className: 'pa-hidden',
            accept: '.png,.jpg,.jpeg,.pdf,.docx,.txt,.mp4,.mov',
            onChange: function (e) {
              var f = e.target.files && e.target.files[0];
              if (f) uploadFile(f);
            },
          }),
          el('button', {
            type: 'button', className: 'pa-composerbtn',
            disabled: !humanOwned || uploading,
            title: __('Attach a file', 'proxyai'), 'aria-label': __('Attach a file', 'proxyai'),
            onClick: function () { if (fileRef.current) fileRef.current.click(); },
          }, el(InboxIcon, { name: 'paperclip', size: 16 })),
          el('textarea', {
            className: 'pa-input pa-thread__draft',
            value: draft, rows: 2,
            placeholder: humanOwned ? __('Reply as agent…', 'proxyai') : __('Take over to reply', 'proxyai'),
            disabled: !humanOwned,
            onChange: function (e) { setDraft(e.target.value); },
            onKeyDown: function (e) {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            },
          }),
          el('button', {
            type: 'button', className: 'pa-composerbtn pa-composerbtn--ai',
            disabled: !humanOwned || suggesting,
            title: __('AI suggested reply', 'proxyai'), 'aria-label': __('AI suggested reply', 'proxyai'),
            onClick: suggest,
          }, el(InboxIcon, { name: 'sparkles', size: 16 })),
          el('button', {
            type: 'button', className: 'pa-composerbtn pa-composerbtn--send',
            disabled: !humanOwned || !draft.trim() || sending,
            'aria-label': __('Send', 'proxyai'),
            onClick: send,
          }, el(InboxIcon, { name: 'send', size: 16 }))))
    );
  }

  /** Ticket threads reuse the same pane, behind a Back button. */
  function Conversation(props) {
    return el(Thread, {
      botId: props.botId,
      conversationId: props.conversationId,
      onBack: props.onBack,
      onChanged: props.onChanged,
    });
  }

  function InboxTab(props) {
    var hasHandoff = props.hasHandoff;
    var botId = props.botId;
    var s1 = useState([]); var conversations = s1[0]; var setConversations = s1[1];
    var s2 = useState(null); var selected = s2[0]; var setSelected = s2[1];
    var s3 = useState(false); var showArchived = s3[0]; var setShowArchived = s3[1];
    var s4 = useState(null); var confirmDelete = s4[0]; var setConfirmDelete = s4[1];
    var s5 = useState(null); var busyRow = s5[0]; var setBusyRow = s5[1];
    var s6 = useState(false); var listLoaded = s6[0]; var setListLoaded = s6[1];
    var s7 = useState(false); var listFailed = s7[0]; var setListFailed = s7[1];

    var loadList = useCallback(function () {
      if (!hasHandoff) return Promise.resolve();
      return api('bots/' + botId + '/handoff?view=list').then(function (data) {
        setConversations(data.conversations || []);
        setListLoaded(true);
        setListFailed(false);
      }, function () { setListFailed(true); });
    }, [botId, hasHandoff]);

    // Poll the list every 5s, skipping hidden tabs and overlapping fetches.
    useEffect(function () {
      if (!hasHandoff) return undefined;
      var inFlight = false;
      function tick() {
        if (document.visibilityState !== 'visible' || inFlight) return;
        inFlight = true;
        loadList().then(function () { inFlight = false; }, function () { inFlight = false; });
      }
      var first = window.setTimeout(tick, 0);
      var timer = window.setInterval(tick, 5000);
      return function () { window.clearTimeout(first); window.clearInterval(timer); };
    }, [loadList, hasHandoff]);

    if (!hasHandoff) {
      // Upsell card: the add-on that unlocks this tab, purchasable in place.
      return el(Card, null,
        el(CardTitle, {
          title: __('Agent inbox', 'proxyai'),
          sub: __('Take over a conversation yourself when the bot can’t help. Included with Human Handoff.', 'proxyai'),
        }),
        el(AddonList, {
          state: {
            catalog: props.state.catalog.filter(function (a) { return a.kind === 'handoff'; }),
          },
          ownedAddonIds: props.state.ownedAddonIds || [],
          onRefresh: props.onRefresh,
          onBuy: props.onBuy,
        }));
    }

    function fileAction(action, conversationId) {
      setConfirmDelete(null);
      setBusyRow(conversationId);
      api('bots/' + botId + '/handoff', {
        method: 'POST',
        data: { action: action, conversationId: conversationId },
      }).then(function () {
        if (action === 'delete' && selected === conversationId) setSelected(null);
        return loadList();
      }, function () {}).then(function () { setBusyRow(null); });
    }

    var active = conversations.filter(function (c) { return !c.archivedAt; });
    var archived = conversations.filter(function (c) { return c.archivedAt; });
    var needsReply = active.filter(function (c) { return c.unreadCount > 0; });
    var humanOwn = active.filter(function (c) { return c.unreadCount === 0 && c.ownerType === 'human'; });
    var botOwn = active.filter(function (c) { return c.unreadCount === 0 && c.ownerType !== 'human'; });
    // Oldest wait first in the needs-attention group; everything else keeps
    // the server's most-recent-first order.
    needsReply.sort(function (a, b) { return String(a.waitingSince || '').localeCompare(String(b.waitingSince || '')); });
    var listed = showArchived ? archived : needsReply.concat(humanOwn, botOwn);

    function row(c) {
      var isSel = selected === c.conversationId;
      var busy = busyRow === c.conversationId;
      return el('div', {
        key: c.conversationId,
        role: 'button', tabIndex: 0,
        className: 'pa-ibxrow' + (isSel ? ' is-selected' : '') + (busy ? ' is-busy' : ''),
        onClick: function () { setSelected(c.conversationId); },
        onKeyDown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(c.conversationId); }
        },
      },
        el('div', { className: 'pa-ibxrow__top' },
          c.avatarKey ? el('img', { className: 'pa-ibxrow__avatar', alt: '', src: attachmentUrl(c.avatarKey) }) : null,
          el('span', { className: 'pa-ibxrow__name' },
            c.displayName || String(c.externalUserId || '').slice(0, 16)),
          c.unreadCount > 0
            // Needs-reply owns the loud badge; ownership is shown quietly.
            ? el('span', {
                className: 'pa-ibxrow__needs',
                title: c.unreadCount + ' ' + __('unanswered', 'proxyai'),
              },
                el('span', { className: 'pa-ibxrow__dot' }),
                __('Needs reply', 'proxyai'),
                c.waitingSince ? el('span', { className: 'pa-ibxrow__wait' }, waitedFor(c.waitingSince)) : null)
            : el('span', {
                className: 'pa-ibxrow__owner' + (c.ownerType === 'human' ? ' is-human' : ''),
              }, c.ownerType === 'human' ? __('Human', 'proxyai') : __('Bot', 'proxyai')),
          el('span', { className: 'pa-ibxrow__tools' },
            el('button', {
              type: 'button', className: 'pa-ibxrow__tool', disabled: busy,
              title: c.archivedAt ? __('Restore', 'proxyai') : __('Archive', 'proxyai'),
              'aria-label': c.archivedAt ? __('Restore conversation', 'proxyai') : __('Archive conversation', 'proxyai'),
              onClick: function (e) {
                e.stopPropagation();
                fileAction(c.archivedAt ? 'unarchive' : 'archive', c.conversationId);
              },
            }, el(InboxIcon, { name: c.archivedAt ? 'restore' : 'archive', size: 13 })),
            el('button', {
              type: 'button', className: 'pa-ibxrow__tool pa-ibxrow__tool--danger', disabled: busy,
              title: __('Delete', 'proxyai'), 'aria-label': __('Delete conversation', 'proxyai'),
              onClick: function (e) { e.stopPropagation(); setConfirmDelete(c.conversationId); },
            }, el(InboxIcon, { name: 'trash', size: 13 })))),
        el('div', { className: 'pa-ibxrow__sub' },
          el('p', { className: 'pa-ibxrow__meta', title: c.conversationId },
            channelLabel(c.channel) + ' · ' + c.conversationId),
          c.unreadCount > 0
            ? el('span', { className: 'pa-ibxrow__count' }, c.unreadCount > 99 ? '99+' : String(c.unreadCount))
            : null),
        confirmDelete === c.conversationId
          // Inline confirm — embedded webviews suppress window.confirm.
          ? el('div', { className: 'pa-ibxrow__confirm' },
              el('span', null, __('Delete this conversation and its transcript?', 'proxyai')),
              el('span', { className: 'pa-ibxrow__confirmbtns' },
                el('button', {
                  type: 'button', className: 'pa-ibxrow__del', disabled: busy,
                  onClick: function (e) { e.stopPropagation(); fileAction('delete', c.conversationId); },
                }, __('Delete', 'proxyai')),
                el('button', {
                  type: 'button', className: 'pa-ibxrow__cancel',
                  onClick: function (e) { e.stopPropagation(); setConfirmDelete(null); },
                }, __('Cancel', 'proxyai'))))
          : null);
    }

    return el(
      'div',
      { className: 'pa-inbox' },
      el('div', { className: 'pa-inbox__list' },
        el('div', { className: 'pa-inbox__listbar' },
          el('span', { className: 'pa-inbox__needslabel' },
            __('Needs reply', 'proxyai') + ' ',
            el('span', { className: needsReply.length > 0 ? 'is-hot' : 'is-cold' }, String(needsReply.length))),
          el('button', {
            type: 'button',
            className: 'pa-inbox__archtoggle' + (showArchived ? ' is-on' : ''),
            onClick: function () { setShowArchived(!showArchived); },
          }, __('Archived', 'proxyai') + ' ' + archived.length),
          el('button', {
            type: 'button', className: 'pa-inbox__refresh',
            'aria-label': __('Refresh', 'proxyai'),
            onClick: function () { loadList(); },
          }, el(InboxIcon, { name: 'refresh' }))),
        el('div', { className: 'pa-inbox__scroll' },
          listFailed ? el(Notice, { kind: 'error' }, __('Could not load the inbox.', 'proxyai')) : null,
          !listLoaded
            ? el(Spinner, null)
            : listed.length === 0
              ? el('p', { className: 'pa-inbox__empty' },
                  showArchived ? __('Nothing archived.', 'proxyai') : __('No conversations yet.', 'proxyai'))
              : listed.map(row))),
      el('div', { className: 'pa-inbox__pane' },
        !selected
          ? el('p', { className: 'pa-inbox__pick' }, __('Select a conversation.', 'proxyai'))
          : el(Thread, {
              key: selected,
              botId: botId,
              conversationId: selected,
              onChanged: loadList,
            }))
    );
  }

  // ------------------------------------------------------------------
  // Tickets tab — the web dashboard's kanban, natively
  // ------------------------------------------------------------------

  var TICKET_COLUMNS = [
    { key: 'open', label: __('Open', 'proxyai'), dot: '#d97706', bg: '#fdeece' },
    { key: 'pending', label: __('Pending', 'proxyai'), dot: '#2563eb', bg: '#dbeafe' },
    { key: 'resolved', label: __('Resolved', 'proxyai'), dot: '#16a34a', bg: '#dff0e4' },
  ];

  var DESK_LABEL = {
    proxyai: __('Built-in', 'proxyai'),
    gorgias: 'Gorgias', zendesk: 'Zendesk', freshdesk: 'Freshdesk', helpscout: 'Help Scout',
  };

  function ticketKey(t) { return t.provider + ':' + t.ticketId; }

  /** Legacy rows: "closed" reads as resolved, "awaiting" as pending. */
  function boardStatus(status) {
    if (status === 'pending' || status === 'awaiting') return 'pending';
    if (status === 'resolved' || status === 'closed') return 'resolved';
    return 'open';
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

  /** Local calendar day, so grouping matches the merchant's own date, not UTC. */
  function dayKey(createdAt) {
    var d = new Date(createdAt);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** "Today" / "Yesterday" / weekday inside the week / "28 Jul" beyond it. */
  function dayLabel(createdAt) {
    var d = new Date(createdAt);
    var days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
    if (days === 0) return __('Today', 'proxyai');
    if (days === 1) return __('Yesterday', 'proxyai');
    if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    var sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** Calendar-day buckets, newest day first and newest ticket first inside. */
  function groupByDay(cards) {
    var buckets = {};
    cards.forEach(function (t) {
      var k = dayKey(t.createdAt);
      (buckets[k] = buckets[k] || []).push(t);
    });
    return Object.keys(buckets).sort().reverse().map(function (key) {
      var list = buckets[key].sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
      return { key: key, label: dayLabel(list[0].createdAt), cards: list };
    });
  }

  /** "Just now" / "58 min ago" / "3 h ago" / "2 d ago". */
  function ticketAge(createdAt) {
    var mins = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
    if (mins < 1) return __('Just now', 'proxyai');
    if (mins < 60) return mins + ' ' + __('min ago', 'proxyai');
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' ' + __('h ago', 'proxyai');
    return Math.floor(hours / 24) + ' ' + __('d ago', 'proxyai');
  }

  // Image markers are transcript bookkeeping; the thread shows the actual
  // file from the attachments column.
  function stripImageMarker(content) {
    return String(content || '').replace(/\[image:[^\]]+\]|\[Image\]/g, '').trim();
  }

  var TICKET_ICON_D = 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z';

  function TicketGlyph(props) {
    return el('svg', {
      width: props.size || 14, height: props.size || 14, viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', strokeWidth: 2,
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
    }, el('path', { d: TICKET_ICON_D }), el('path', { d: 'M13 5v2' }), el('path', { d: 'M13 17v2' }), el('path', { d: 'M13 11v2' }));
  }

  /**
   * Ticket thread: author+timestamp cards with the reply composer below.
   * A reply is not a takeover — the bot keeps answering in chat.
   */
  function TicketThread(props) {
    var botId = props.botId;
    var ticket = props.ticket;
    var s1 = useState(null); var messages = s1[0]; var setMessages = s1[1];
    var s2 = useState(''); var body = s2[0]; var setBody = s2[1];
    var s3 = useState(false); var sending = s3[0]; var setSending = s3[1];
    var s4 = useState(null); var error = s4[0]; var setError = s4[1];

    var customerName = ticket.contactName || ticket.contactEmail || __('Customer', 'proxyai');
    var resolved = boardStatus(ticket.status) === 'resolved';

    var load = useCallback(function () {
      return api('bots/' + botId + '/handoff?view=messages&conversationId=' + encodeURIComponent(ticket.conversationId))
        .then(function (data) { setMessages(data.messages || []); }, function () {});
    }, [botId, ticket.conversationId]);

    useEffect(function () {
      var inFlight = false;
      function tick() {
        if (document.visibilityState !== 'visible' || inFlight) return;
        inFlight = true;
        load().then(function () { inFlight = false; }, function () { inFlight = false; });
      }
      var first = window.setTimeout(function () { load(); }, 0);
      var timer = window.setInterval(tick, 15000);
      return function () { window.clearTimeout(first); window.clearInterval(timer); };
    }, [load]);

    function send() {
      if (!body.trim() || sending || resolved) return;
      setSending(true);
      setError(null);
      api('bots/' + botId + '/handoff', {
        method: 'POST',
        data: { action: 'reply', conversationId: ticket.conversationId, text: body.trim() },
      }).then(function () {
        setBody('');
        return load().then(props.onReplied);
      }, function (err) {
        var detail = err && err.detail ? String(err.detail).trim() : '';
        if (detail && detail.indexOf('24-hour window') !== -1) setError(detail);
        else if (detail) setError(__('Send failed', 'proxyai') + ' (' + (err.status || '') + '): ' + detail);
        else setError(__('Send failed.', 'proxyai'));
      }).then(function () { setSending(false); });
    }

    function card(m, i) {
      var kids = [
        el('div', { key: 'h', className: 'pa-tkmsg__head' },
          el('span', { className: 'pa-tkmsg__who' },
            m.role === 'user' ? customerName : m.role === 'agent' ? __('You', 'proxyai') : __('Bot', 'proxyai')),
          el('span', { className: 'pa-tkmsg__at' }, new Date(m.createdAt).toLocaleString())),
        el('p', { key: 'b', className: 'pa-tkmsg__body' }, stripImageMarker(m.content)),
      ];
      (m.attachments || []).filter(safeAttachment).forEach(function (a, j) {
        if (String(a.contentType || '').indexOf('image/') === 0) {
          kids.push(el('img', { key: 'a' + j, className: 'pa-tkmsg__img', src: a.dataUrl, alt: a.name || __('Attachment', 'proxyai') }));
        } else {
          kids.push(el('a', { key: 'a' + j, className: 'pa-tkmsg__file', href: a.dataUrl, download: a.name || 'attachment' },
            a.name || __('Download attachment', 'proxyai')));
        }
      });
      return el('div', { key: i, className: 'pa-tkmsg' + (m.role === 'user' ? '' : ' pa-tkmsg--own') }, kids);
    }

    return el('div', { className: 'pa-tkthread' },
      el('div', { className: 'pa-tkthread__scroll' },
        messages === null
          ? el('p', { className: 'pa-tkthread__note' }, __('Loading thread…', 'proxyai'))
          : messages.length === 0
            ? el('p', { className: 'pa-tkthread__note' }, __('No messages yet.', 'proxyai'))
            : messages.map(card)),
      el('div', { className: 'pa-tkcomposer' },
        el('textarea', {
          className: 'pa-input pa-tkcomposer__area',
          rows: 3, value: body, disabled: resolved,
          placeholder: resolved
            ? __('Move the ticket back to Open to reply.', 'proxyai')
            : __("Reply to the customer — they'll get this on their chat channel.", 'proxyai'),
          onChange: function (e) { setBody(e.target.value); },
        }),
        error ? el('p', { className: 'pa-tkcomposer__err' }, error) : null,
        el('div', { className: 'pa-tkcomposer__row' },
          el(Button, { variant: 'primary', busy: sending, disabled: !body.trim() || resolved, onClick: send },
            sending ? __('Sending…', 'proxyai') : __('Send reply', 'proxyai')))));
  }

  function TicketsTab(props) {
    var botId = props.botId;
    var enabled = props.hasTickets;
    var s1 = useState([]); var tickets = s1[0]; var setTickets = s1[1];
    var s2 = useState(true); var loading = s2[0]; var setLoading = s2[1];
    var s3 = useState(''); var q = s3[0]; var setQ = s3[1];
    var s4 = useState(null); var openTicket = s4[0]; var setOpenTicket = s4[1];
    var s5 = useState(null); var dragged = s5[0]; var setDragged = s5[1];
    var s6 = useState(null); var dropTarget = s6[0]; var setDropTarget = s6[1];
    var s7 = useState(false); var showArchived = s7[0]; var setShowArchived = s7[1];
    // Collapsed date groups, keyed `${column}:${day}` — component state so
    // a refetch cannot spring a group back open.
    var s8 = useState({}); var collapsedDays = s8[0]; var setCollapsedDays = s8[1];
    var s9 = useState(null); var error = s9[0]; var setError = s9[1];
    // Poll snapshots are stale while a move/archive is pending — applying
    // one would snap the dragged card back.
    var mutating = useRef(0);

    var loadList = useCallback(function () {
      if (!enabled) return Promise.resolve();
      return api('bots/' + botId + '/handoff?view=list').then(function (data) {
        if (mutating.current > 0) return;
        setTickets(data.tickets || []);
        setLoading(false);
      }, function () {});
    }, [botId, enabled]);

    // Polling, not SSE: the PHP proxy buffers streams. 15s is fresh enough.
    useEffect(function () {
      if (!enabled) return undefined;
      var inFlight = false;
      function tick() {
        if (document.visibilityState !== 'visible' || inFlight) return;
        inFlight = true;
        loadList().then(function () { inFlight = false; }, function () { inFlight = false; });
      }
      var first = window.setTimeout(tick, 0);
      var timer = window.setInterval(tick, 15000);
      document.addEventListener('visibilitychange', tick);
      return function () {
        window.clearTimeout(first);
        window.clearInterval(timer);
        document.removeEventListener('visibilitychange', tick);
      };
    }, [loadList, enabled]);

    if (!enabled) {
      return el(Card, null,
        el(CardTitle, {
          title: __('Tickets', 'proxyai'),
          sub: __('The ticket board comes with the Helpdesk add-on and its built-in desk switched on.', 'proxyai'),
        }));
    }

    function setStatus(t, status) {
      if (boardStatus(t.status) === status) return;
      setError(null);
      // Optimistic; a failed move reloads the real state with the error shown.
      setTickets(function (cur) {
        return cur.map(function (r) { return ticketKey(r) === ticketKey(t) ? Object.assign({}, r, { status: status }) : r; });
      });
      mutating.current += 1;
      api('bots/' + botId + '/handoff', {
        method: 'POST',
        data: { action: 'ticket_status', provider: t.provider, ticketId: t.ticketId, status: status },
      }).then(function () { mutating.current -= 1; }, function () {
        mutating.current -= 1;
        setError(__('Could not move', 'proxyai') + ' ' + t.ticketId + '. ' + __('It is unchanged.', 'proxyai'));
        loadList();
      });
    }

    // Restore pulls an archived ticket back onto the board (still resolved).
    function setArchivedFlag(t, archived) {
      setError(null);
      setTickets(function (cur) {
        return cur.map(function (r) {
          return ticketKey(r) === ticketKey(t)
            ? Object.assign({}, r, { archivedAt: archived ? new Date().toISOString() : null })
            : r;
        });
      });
      mutating.current += 1;
      api('bots/' + botId + '/handoff', {
        method: 'POST',
        data: { action: archived ? 'archive_ticket' : 'unarchive_ticket', provider: t.provider, ticketId: t.ticketId },
      }).then(function () { mutating.current -= 1; }, function () {
        mutating.current -= 1;
        setError(__('Could not update', 'proxyai') + ' ' + t.ticketId + '. ' + __('It is unchanged.', 'proxyai'));
        loadList();
      });
    }

    var lowered = q.trim().toLowerCase();
    function matches(t) {
      if (!lowered) return true;
      return [t.ticketId, t.subject, t.category, t.contactName, t.contactEmail].some(function (v) {
        return String(v || '').toLowerCase().indexOf(lowered) !== -1;
      });
    }
    var filtered = tickets.filter(function (t) { return !t.archivedAt && matches(t); });
    var archivedList = tickets.filter(function (t) { return !!t.archivedAt && matches(t); });
    var current = tickets.filter(function (t) { return ticketKey(t) === openTicket; })[0] || null;

    function ticketCard(col, t) {
      var key = ticketKey(t);
      var initial = (t.contactEmail || '?').slice(0, 1).toUpperCase();
      return el('div', {
        key: key,
        className: 'pa-tk' + (dragged === key ? ' is-dragged' : ''),
        draggable: true, role: 'button', tabIndex: 0,
        onDragStart: function (e) {
          e.dataTransfer.setData('text/plain', key);
          e.dataTransfer.effectAllowed = 'move';
          setDragged(key);
        },
        onDragEnd: function () { setDragged(null); },
        onClick: function () { setOpenTicket(key); },
        onKeyDown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenTicket(key); }
        },
      },
        el('div', { className: 'pa-tk__top' },
          el('span', { className: 'pa-tk__subject' },
            el(TicketGlyph, { size: 14 }),
            el('span', { className: 'pa-tk__subjecttext' }, t.subject || __('(no subject)', 'proxyai'))),
          el('span', { className: 'pa-tk__flags' },
            t.unread ? el('span', { className: 'pa-tk__bell', title: __('Unread reply', 'proxyai') }, '•') : null,
            el('span', { className: 'pa-tk__grip' }, '⋮⋮'))),
        el('span', { className: 'pa-tk__idrow' },
          el('span', { className: 'pa-tk__id' }, t.ticketId),
          t.category ? el('span', { className: 'pa-tk__cat' }, t.category) : null),
        el('div', { className: 'pa-tk__foot' },
          el('span', { className: 'pa-tk__contact' },
            el('span', { className: 'pa-tk__avatar' }, initial),
            el('span', { className: 'pa-tk__name' }, t.contactName || t.contactEmail || __('Unknown', 'proxyai'))),
          el('span', { className: 'pa-tk__age' }, ticketAge(t.createdAt))),
        el('span', { className: 'pa-tk__desk' },
          (DESK_LABEL[t.provider] || t.provider) + ' · ' + channelLabel(t.channel)));
    }

    function column(col) {
      var cards = filtered.filter(function (t) { return boardStatus(t.status) === col.key; });
      return el('div', {
        key: col.key,
        className: 'pa-tkcol' + (dropTarget === col.key ? ' is-target' : ''),
        onDragOver: function (e) { e.preventDefault(); setDropTarget(col.key); },
        onDragLeave: function () { setDropTarget(function (cur) { return cur === col.key ? null : cur; }); },
        onDrop: function (e) {
          e.preventDefault();
          setDropTarget(null);
          var key = e.dataTransfer.getData('text/plain') || dragged;
          var t = tickets.filter(function (r) { return ticketKey(r) === key; })[0];
          if (t) setStatus(t, col.key);
          setDragged(null);
        },
      },
        el('div', { className: 'pa-tkcol__head' },
          el('span', { className: 'pa-tkcol__dot', style: { background: col.dot } }),
          el('span', { className: 'pa-tkcol__label' }, col.label),
          el('span', { className: 'pa-tkcol__count', style: { background: col.bg, color: col.dot } }, String(cards.length))),
        el('div', { className: 'pa-tkcol__cards' },
          cards.length === 0
            ? el('p', { className: 'pa-tkcol__empty' },
                col.key === 'open' ? __('No open tickets.', 'proxyai') : __('Drop tickets here.', 'proxyai'))
            : null,
          groupByDay(cards).map(function (group) {
            var groupKey = col.key + ':' + group.key;
            var isCollapsed = !!collapsedDays[groupKey];
            return el('section', { key: groupKey, className: 'pa-tkgroup' },
              el('button', {
                type: 'button', className: 'pa-tkgroup__head', 'aria-expanded': !isCollapsed,
                onClick: function () {
                  setCollapsedDays(function (cur) {
                    var next = Object.assign({}, cur);
                    if (next[groupKey]) delete next[groupKey]; else next[groupKey] = true;
                    return next;
                  });
                },
              },
                el('span', { className: 'pa-tkgroup__chev' + (isCollapsed ? '' : ' is-open') }, '›'),
                el('span', { className: 'pa-tkgroup__label' }, group.label),
                // Collapsed rows carry the hidden-card count.
                isCollapsed
                  ? el('span', { className: 'pa-tkgroup__count', style: { background: col.bg, color: col.dot } },
                      group.cards.length + ' ' + col.label.toLowerCase())
                  : null),
              isCollapsed ? null : group.cards.map(function (t) { return ticketCard(col, t); }));
          })));
    }

    var dialog = null;
    if (current) {
      var meta = [current.ticketId, DESK_LABEL[current.provider] || current.provider, channelLabel(current.channel)];
      if (current.category) meta.push(current.category);
      if (current.contactName) meta.push(current.contactName);
      if (current.contactEmail) meta.push(current.contactEmail);
      dialog = el('div', { className: 'pa-tkdialog', onClick: function (e) { if (e.target === e.currentTarget) setOpenTicket(null); } },
        el('div', { className: 'pa-tkdialog__panel', role: 'dialog', 'aria-modal': 'true' },
          el('div', { className: 'pa-tkdialog__head' },
            el('div', { className: 'pa-tkdialog__titles' },
              el('h2', { className: 'pa-tkdialog__title' }, current.subject || __('(no subject)', 'proxyai')),
              el('span', { className: 'pa-tkdialog__meta' }, meta.join(' · '))),
            el('div', { className: 'pa-tkdialog__tools' },
              current.provider !== 'proxyai' && String(current.url || '').indexOf('https://') === 0
                ? el('a', {
                    className: 'pa-tkdialog__ext', href: current.url, target: '_blank', rel: 'noopener noreferrer',
                  }, __('Open in', 'proxyai') + ' ' + (DESK_LABEL[current.provider] || current.provider))
                : null,
              el('button', {
                type: 'button', className: 'pa-tkdialog__close', 'aria-label': __('Close', 'proxyai'),
                onClick: function () { setOpenTicket(null); },
              }, '✕'))),
          el(TicketThread, {
            botId: botId,
            ticket: current,
            onReplied: function () {
              // A reply moves an open ticket to Pending.
              if (boardStatus(current.status) === 'open') setStatus(current, 'pending');
              else loadList();
            },
          })));
    }

    return el('div', { className: 'pa-tickets' },
      el('div', { className: 'pa-tickets__bar' },
        el('div', { className: 'pa-tickets__views' },
          [{ key: 'current', label: __('Current', 'proxyai') },
           { key: 'archived', label: __('Archived', 'proxyai') + ' ' + archivedList.length }].map(function (v) {
            var on = (v.key === 'archived') === showArchived;
            return el('button', {
              key: v.key, type: 'button',
              className: 'pa-tickets__view' + (on ? ' is-active' : ''),
              onClick: function () { setShowArchived(v.key === 'archived'); },
            }, v.label);
          })),
        el('label', { className: 'pa-tickets__search' },
          el('span', { className: 'pa-tickets__searchglyph', 'aria-hidden': 'true' }, '⌕'),
          el('input', {
            type: 'search', value: q,
            placeholder: __('Search ticket ID, name, email, subject, category', 'proxyai'),
            onChange: function (e) { setQ(e.target.value); },
          }))),
      error ? el(Notice, { kind: 'error' }, error) : null,
      loading
        ? el('p', { className: 'pa-tickets__loading' }, __('Loading…', 'proxyai'))
        : showArchived
          ? el('div', { className: 'pa-tkarchive' },
              archivedList.length === 0
                ? el('p', { className: 'pa-tickets__loading' },
                    __('Nothing archived. Resolved tickets archive automatically per your Helpdesk settings.', 'proxyai'))
                : archivedList.map(function (t) {
                    return el('div', { key: ticketKey(t), className: 'pa-tk pa-tk--archived' },
                      el('span', { className: 'pa-tk__subject' },
                        el(TicketGlyph, { size: 14 }),
                        el('span', { className: 'pa-tk__subjecttext' }, t.subject || __('(no subject)', 'proxyai'))),
                      el('span', { className: 'pa-tk__id' },
                        t.ticketId + ' · ' + (t.contactEmail || __('Unknown', 'proxyai')) + ' · ' + ticketAge(t.createdAt)),
                      el('div', { className: 'pa-tk__restore' },
                        el('button', {
                          type: 'button', className: 'pa-tk__restorebtn',
                          onClick: function () { setArchivedFlag(t, false); },
                        }, __('Restore to board', 'proxyai'))));
                  }))
          : el('div', { className: 'pa-tkboard' }, TICKET_COLUMNS.map(column)),
      dialog);
  }

  // ------------------------------------------------------------------
  // Usage tab
  // ------------------------------------------------------------------

  var CHANNEL_OPTIONS = [
    { value: 'all', label: __('All channels', 'proxyai') },
    { value: 'web', label: 'Web' },
    { value: 'whatsapp_bridge', label: 'WhatsApp' },
    { value: 'telegram', label: 'Telegram' },
    { value: 'line', label: 'LINE' },
    { value: 'dashboard', label: __('Dashboard', 'proxyai') },
    { value: 'rag_ingest', label: __('Knowledge implant', 'proxyai') },
    { value: 'rag_storage', label: __('Knowledge storage', 'proxyai') },
    { value: 'rag_query', label: __('Knowledge retrieval', 'proxyai') },
  ];

  var TYPE_LABEL = {
    ai_chat: 'AI chat',
    abuse_guard: 'Abuse guard',
    handoff: 'Hand-off',
    platform_ai: 'Platform AI',
    rag: 'Bot Knowledge',
    ticket_email: 'Ticket email',
    device_pairing: 'Device pairing',
  };

  var SOURCE_LABEL = {
    dashboard: 'Dashboard',
    rag_ingest: 'Knowledge implant',
    rag_storage: 'Knowledge storage',
    rag_query: 'Knowledge retrieval',
    whatsapp_bridge: 'WhatsApp',
    web: 'Web',
    telegram: 'Telegram',
    line: 'LINE',
  };

  function bytesFmt(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /** Proof of work for rows with no conversation. Mirrors UsageLogClient's DetailFacts. */
  function DetailFacts(props) {
    var d = props.detail;
    var facts = [];
    switch (d.kind) {
      case 'rag_ingest':
        facts = [
          [__('Document', 'proxyai'), d.document],
          [__('Chunks', 'proxyai'), d.replaced > 0 ? d.chunks + ' (replaced ' + d.replaced + ')' : String(d.chunks)],
          [__('Source', 'proxyai'), bytesFmt(d.bytes)],
          [__('Vector requests', 'proxyai'), String(d.requests)],
        ];
        break;
      case 'rag_query':
        facts = [[__('Top N', 'proxyai'), String(d.topN)], [__('Vector requests', 'proxyai'), String(d.requests)]];
        break;
      case 'platform_ai':
        facts = [
          [__('Action', 'proxyai'), d.action],
          [__('Model', 'proxyai'), d.model],
          [__('Size', 'proxyai'), (d.inputChars || 0).toLocaleString() + ' → ' + (d.outputChars || 0).toLocaleString() + ' chars'],
        ];
        break;
      case 'abuse_guard':
        facts = [[__('Guard', 'proxyai'), d.guard], [__('Verdict', 'proxyai'), d.verdict]];
        if (d.reason) facts.push([__('Reason', 'proxyai'), d.reason]);
        break;
      case 'handoff':
        facts = [
          [__('Action', 'proxyai'), __('Agent briefing', 'proxyai')],
          [__('Model', 'proxyai'), d.model],
          [__('Turns summarised', 'proxyai'), String(d.turns)],
        ];
        break;
      case 'ticket_email':
        facts = [
          [__('Action', 'proxyai'), d.action === 'connect' ? __('Sending domain attached', 'proxyai') : __('Reply emailed', 'proxyai')],
          [__('Ticket', 'proxyai'), d.ticket],
          [__('Sent to', 'proxyai'), d.to],
        ];
        break;
      case 'device_pairing':
        facts = [
          [__('Action', 'proxyai'), __('Phone linked to the agent inbox', 'proxyai')],
          [__('Device', 'proxyai'), '#' + d.seat + ' ' + __('on this account', 'proxyai')],
          [__('Store', 'proxyai'), d.tenant || d.platform],
        ];
        break;
      default:
        return null;
    }

    return el(
      'div',
      null,
      el('p', { className: 'pa-facts__head' }, __('Work done', 'proxyai')),
      el('dl', { className: 'pa-facts' }, facts.map(function (f) {
        return el(Fragment, { key: f[0] },
          el('dt', null, f[0]),
          el('dd', null, f[1] == null ? '—' : String(f[1])));
      })),
      d.kind === 'rag_query'
        ? el('div', null,
            el('p', { className: 'pa-facts__head' }, __('Chunks retrieved', 'proxyai')),
            !d.hits || d.hits.length === 0
              ? el('p', { className: 'pa-card__sub' }, __('No matches above the cutoff.', 'proxyai'))
              : el('ol', { className: 'pa-facts__hits' }, d.hits.map(function (hit, i) {
                  return el('li', { key: hit.document + i },
                    el('span', { className: 'pa-facts__doc' }, hit.document),
                    el('span', { className: 'pa-facts__score' }, hit.score.toFixed(3)));
                })))
        : null
    );
  }

  function UsageTab(props) {
    var s1 = useState(null); var data = s1[0]; var setData = s1[1];
    var s2 = useState(false); var failed = s2[0]; var setFailed = s2[1];
    var s3 = useState(1); var page = s3[0]; var setPage = s3[1];
    var s4 = useState('all'); var channel = s4[0]; var setChannel = s4[1];
    var s5 = useState(''); var from = s5[0]; var setFrom = s5[1];
    var s6 = useState(''); var to = s6[0]; var setTo = s6[1];
    var s7 = useState(null); var expanded = s7[0]; var setExpanded = s7[1];

    useEffect(function () {
      var cancelled = false;
      var qs = [];
      if (from) qs.push('from=' + encodeURIComponent(from));
      if (to) qs.push('to=' + encodeURIComponent(to));
      if (channel !== 'all') qs.push('channel=' + encodeURIComponent(channel));
      qs.push('page=' + page);
      api('bots/' + props.botId + '/usage?' + qs.join('&')).then(
        function (res) { if (!cancelled) { setData(res); setFailed(false); } },
        function () { if (!cancelled) setFailed(true); }
      );
      return function () { cancelled = true; };
    }, [props.botId, from, to, channel, page]);

    var entries = (data && data.entries) || [];
    var total = (data && data.total) || 0;
    var pageSize = (data && data.pageSize) || 25;
    var pageCount = Math.max(1, Math.ceil(total / pageSize));

    return el(
      Card,
      null,
      el(CardTitle, { title: __('Usage & costs', 'proxyai') }),
      el(
        'div',
        { className: 'pa-filters' },
        el(Field, { label: __('From', 'proxyai') },
          el(TextInput, { type: 'date', value: from, onChange: function (v) { setFrom(v); setPage(1); } })),
        el(Field, { label: __('To', 'proxyai') },
          el(TextInput, { type: 'date', value: to, onChange: function (v) { setTo(v); setPage(1); } })),
        el(Field, { label: __('Channel', 'proxyai') },
          el(SelectInput, { value: channel, onChange: function (v) { setChannel(v); setPage(1); }, options: CHANNEL_OPTIONS })),
        (from || to || channel !== 'all')
          ? el('button', {
              type: 'button', className: 'pa-link pa-filters__clear',
              onClick: function () { setFrom(''); setTo(''); setChannel('all'); setPage(1); },
            }, __('Clear', 'proxyai'))
          : null,
        el('button', {
          type: 'button',
          className: 'pa-btn pa-filters__export',
          disabled: total === 0,
          title: __('Export CSV', 'proxyai'),
          onClick: function () {
            // Exports every row matching the filters, not just this page.
            // The proxy wraps the CSV bytes as `raw`.
            var qs = ['format=csv'];
            if (from) qs.push('from=' + encodeURIComponent(from));
            if (to) qs.push('to=' + encodeURIComponent(to));
            if (channel !== 'all') qs.push('channel=' + encodeURIComponent(channel));
            api('bots/' + props.botId + '/usage?' + qs.join('&')).then(function (res) {
              var text = res && res.raw ? res.raw : '';
              if (!text) return;
              var blob = new window.Blob([text], { type: 'text/csv' });
              var a = document.createElement('a');
              a.href = window.URL.createObjectURL(blob);
              a.download = 'proxyai-usage.csv';
              a.click();
              window.URL.revokeObjectURL(a.href);
            }, function () {});
          },
        }, __('Export CSV', 'proxyai'))
      ),
      failed ? el(Notice, { kind: 'error' }, __('Failed to load the usage log.', 'proxyai')) : null,
      !data
        ? el(Spinner, null)
        : entries.length === 0
          ? el('p', { className: 'pa-card__sub' }, __('No usage in this range.', 'proxyai'))
          : el(
              'table',
              { className: 'widefat striped pa-usage' },
              el('thead', null, el('tr', null,
                el('th', null, __('Channel', 'proxyai')),
                el('th', null, __('Date & time', 'proxyai')),
                el('th', null, __('Type', 'proxyai')),
                el('th', null, __('Tokens', 'proxyai')),
                el('th', null, __('Cost', 'proxyai')))),
              el('tbody', null, entries.map(function (e) {
                var isOpen = expanded === e.id;
                var cost = Number(e.cost);
                return el(
                  Fragment,
                  { key: e.id },
                  el('tr', {
                    className: 'pa-usage__row',
                    onClick: function () { setExpanded(isOpen ? null : e.id); },
                  },
                    el('td', { className: 'pa-usage__channel' }, SOURCE_LABEL[e.channel] || e.channel),
                    el('td', null, fmtDate(e.executedAt)),
                    el('td', null,
                      el('span', {
                        className: 'pa-usage__type' + (e.type === 'abuse_guard' ? ' pa-usage__type--guard' : ''),
                      }, TYPE_LABEL[e.type] || e.type)),
                    el('td', null, (e.tokensIn || 0) + ' in / ' + (e.tokensOut || 0) + ' out'),
                    el('td', null, e.cost && !isNaN(cost) ? (cost === 0 ? '$0' : '$' + cost.toFixed(6)) : '—')),
                  isOpen
                    ? el('tr', null, el('td', { colSpan: 5, className: 'pa-usage__detail' },
                        e.detail ? el(DetailFacts, { detail: e.detail }) : null,
                        // Only chat turns have a message pair.
                        (e.message || e.response || !e.detail)
                          ? el(Fragment, null,
                              el('p', { className: 'pa-facts__head' }, __('Message', 'proxyai')),
                              el('p', { className: 'pa-usage__text' }, e.message || __('(not recorded)', 'proxyai')),
                              el('p', { className: 'pa-facts__head' }, __('Response', 'proxyai')),
                              el('p', { className: 'pa-usage__text' }, e.response || __('(not recorded)', 'proxyai')))
                          : null))
                    : null
                );
              }))
            ),
      total > 0
        ? el('div', { className: 'pa-pager' },
            el('span', null, ((page - 1) * pageSize + 1) + '–' + Math.min(page * pageSize, total) + ' / ' + total),
            el('span', null,
              el(Button, { disabled: page <= 1, onClick: function () { setPage(page - 1); } }, '←'),
              el('span', { className: 'pa-pager__page' }, page + ' / ' + pageCount),
              el(Button, { disabled: page >= pageCount, onClick: function () { setPage(page + 1); } }, '→')))
        : null
    );
  }

  // ------------------------------------------------------------------
  // Rates tab
  // ------------------------------------------------------------------

  // Mirrors the hosted dashboard's rate table.
  var RATE_GROUPS = [
    {
      title: __('Built-in helpdesk', 'proxyai'),
      blurb: __('Running the ticket board costs nothing. Ticket email sends through the support mailbox you already own — an app password, no new accounts, no DNS.', 'proxyai'),
      lines: [
        { label: __('Opening tickets', 'proxyai'), value: __('Free', 'proxyai') },
        { label: __('Built-in desk', 'proxyai'), value: __('Free', 'proxyai') },
        { label: __('Connecting another helpdesk', 'proxyai'), value: __('Free', 'proxyai'),
          note: __('Gorgias, Zendesk, Freshdesk, Help Scout — you pay them, not us', 'proxyai') },
        { label: __('Connecting your mailbox', 'proxyai'), value: __('Free', 'proxyai'),
          note: __('replies land back on your ticket board automatically', 'proxyai') },
        { label: __('Per 100 emails we send', 'proxyai'), value: '$1' },
        { label: __('Per 100 emails we receive', 'proxyai'), value: '$1',
          note: __('replies and forwarded emails that land on your ticket board', 'proxyai') },
      ],
    },
    {
      title: __('Agent inbox', 'proxyai'),
      blurb: __('Taking over conversations is included with Human Handoff. Linking the phone app is the only thing with a price on it.', 'proxyai'),
      lines: [
        { label: __('First device paired', 'proxyai'), value: __('Free', 'proxyai') },
        { label: __('Each device after that', 'proxyai'), value: '$1' },
      ],
    },
  ];

  var CHUNK_STEP = 1200 - 150;
  var BYTES_PER_MB = 1024 * 1024;

  function RatesTab(props) {
    var s1 = useState(null); var rates = s1[0]; var setRates = s1[1];
    var s2 = useState('1000'); var messages = s2[0]; var setMessages = s2[1];
    var s3 = useState('10'); var sizeMb = s3[0]; var setSizeMb = s3[1];
    var s4 = useState(''); var modelId = s4[0]; var setModelId = s4[1];
    var s5 = useState(800); var words = s5[0]; var setWords = s5[1];
    var s6 = useState('100'); var storeOps = s6[0]; var setStoreOps = s6[1];

    useEffect(function () {
      api('wordpress/rates').then(function (res) {
        setRates(res);
        if (res && res.models && res.models.length && !modelId) {
          // Default to DeepSeek; first listed model otherwise.
          var preferred = res.models.filter(function (m) {
            return /deepseek/i.test(m.id) || /deepseek/i.test(m.label || '');
          })[0] || res.models[0];
          setModelId(preferred.id);
        }
      }, function () {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!rates) return el(Card, null, el(Spinner, null));

    var messageCount = Math.max(0, Number(messages) || 0);
    var documentMb = Math.max(0, Number(sizeMb) || 0);
    var chunks = documentMb > 0 ? Math.ceil((documentMb * BYTES_PER_MB) / CHUNK_STEP) : 0;
    var perRequest = (rates.requestPricePer100k * rates.vectorFactor) / 100000;
    var implantRequests = chunks > 0 ? chunks * 2 + 1 : 0;
    var implantCost = implantRequests * perRequest;
    var storageCost = documentMb * (rates.storagePricePerGbMonth / 1000) * rates.vectorFactor;
    var retrievalCost = messageCount * 2 * perRequest;
    var model = null;
    (rates.models || []).forEach(function (m) { if (m.id === modelId) model = m; });
    var tokensPerMessage = words / 0.75;
    var aiCost = model
      ? (messageCount * tokensPerMessage * 0.75 * model.promptPrice +
         messageCount * tokensPerMessage * 0.25 * model.completionPrice) * rates.tokenFactor
      : 0;
    var storeOpCost = (Math.max(0, Number(storeOps) || 0) / 100) * (rates.mcpCallPer100 || 0);
    var monthly = storageCost + retrievalCost + aiCost + storeOpCost;

    var rows = [
      [__('Documents implant', 'proxyai'), implantCost, __('one-off', 'proxyai')],
      [__('Document storage', 'proxyai'), storageCost, __('monthly', 'proxyai')],
      [__('Knowledge retrieval', 'proxyai'), retrievalCost, __('monthly', 'proxyai')],
    ];
    if ((rates.mcpCallPer100 || 0) > 0) rows.push([__('Store operations', 'proxyai'), storeOpCost, __('monthly', 'proxyai')]);
    rows.push([__('AI cost', 'proxyai'), aiCost, __('monthly', 'proxyai')]);

    return el(
      Fragment,
      null,
      el(
        Card,
        null,
        el(CardTitle, {
          title: __('Estimate your monthly cost', 'proxyai'),
          sub: __('Choose a model and expected sizes; the rates are the ones the system actually bills.', 'proxyai'),
        }),
        el('div', { className: 'pa-calcgrid' },
          el(Field, { label: __('LLM model', 'proxyai'), hint: __('Active models from Model Selection', 'proxyai') },
            el(SelectInput, {
              value: modelId, onChange: setModelId,
              options: (rates.models || []).map(function (m) {
                return { value: m.id, label: m.label + ' · ' + m.tier.charAt(0).toUpperCase() + m.tier.slice(1) };
              }),
            })),
          el(Field, { label: __('Messages per month', 'proxyai'), hint: __('per month', 'proxyai') },
            el(TextInput, { type: 'number', value: messages, onChange: setMessages, min: 0, step: 100 })),
          el('div', { className: 'pa-calcgrid__span pa-sliderrow' },
            el('span', { className: 'pa-sliderrow__head' },
              el('span', { className: 'pa-field__label' }, __('Words per message', 'proxyai')),
              el('strong', { className: 'pa-sliderrow__value' }, words.toLocaleString() + ' ' + __('words', 'proxyai'))),
            el('input', {
              type: 'range', min: 500, max: 2000, step: 100, value: words, className: 'pa-range',
              onChange: function (e) { setWords(Number(e.target.value)); },
            }),
            el('span', { className: 'pa-sliderrow__scale' },
              el('span', null, '500 ' + __('words', 'proxyai')),
              el('span', null, '2,000 ' + __('words', 'proxyai')))),
          (rates.mcpCallPer100 || 0) > 0
            ? el(Field, { label: __('Store operations per month', 'proxyai'), hint: __('catalogue, product, policy and cart lookups', 'proxyai') },
                el(TextInput, { type: 'number', value: storeOps, onChange: setStoreOps, min: 0 }))
            : null,
          el(Field, {
            label: __('Knowledge size (MB)', 'proxyai'),
            hint: chunks > 0 ? '≈ ' + chunks.toLocaleString() + ' ' + __('chunks', 'proxyai') : __('total across all documents', 'proxyai'),
          },
            el(TextInput, { type: 'number', value: sizeMb, onChange: setSizeMb, min: 0 }))),
        el('table', { className: 'widefat striped' },
          el('tbody', null,
            rows.map(function (r) {
              return el('tr', { key: r[0] },
                el('td', null, r[0]),
                el('td', { className: 'pa-num' }, money(r[1])),
                el('td', null, r[2]));
            }),
            el('tr', { className: 'pa-total' },
              el('td', null, el('strong', null, __('Monthly total', 'proxyai'))),
              el('td', { className: 'pa-num' }, el('strong', null, money(monthly))),
              el('td', null, __('AI + storage + retrieval, excluding implant', 'proxyai'))))),
        el('p', { className: 'pa-card__fine' },
          __('AI estimate converts every 0.75 words to 1 token, then assumes 75% input and 25% output. Message words may contain any additional system instructions. Actual usage varies by conversation. Actual chunk counts depend on document structure. Implant is charged again when a document is re-uploaded.', 'proxyai'))
      ),
      RATE_GROUPS.map(function (g) {
        return el(Card, { key: g.title },
          el(CardTitle, { title: g.title, sub: g.blurb }),
          el('table', { className: 'widefat striped' },
            el('tbody', null, g.lines.map(function (line) {
              return el('tr', { key: line.label },
                el('td', null, line.label,
                  line.note ? el('span', { className: 'pa-rates__note' }, line.note) : null),
                el('td', { className: 'pa-num' }, line.value));
            }))));
      })
    );
  }

  // ------------------------------------------------------------------
  // Contact ProxyAI support — mirrors the web SupportTab, OpenTicketDialog
  // and lib/tickets, so the server validates against the same rules.
  // ------------------------------------------------------------------

  var TICKET_EXTS = ['.png', '.jpg', '.jpeg', '.pdf', '.docx', '.txt', '.mp4', '.mov'];
  var TICKET_ACCEPT = TICKET_EXTS.join(',');
  var TICKET_MAX_FILE_BYTES = 3 * 1024 * 1024;
  var TICKET_MAX_FILES = 5;
  // MIME → extensions, mirroring lib/tickets TICKET_ALLOWED_TYPES.
  var TICKET_MIME = {
    'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'application/pdf': ['.pdf'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'text/plain': ['.txt'], 'video/mp4': ['.mp4'], 'video/quicktime': ['.mov'],
  };
  function ticketFileOk(name, mime) {
    var ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (TICKET_EXTS.indexOf(ext) === -1) return false;
    var allowed = TICKET_MIME[mime];
    // A generic/blank MIME passes on the extension alone; a known MIME must
    // agree, so a .png renamed .pdf is caught.
    if (!allowed) return mime === '' || mime === 'application/octet-stream';
    return allowed.indexOf(ext) !== -1;
  }

  var TICKET_STATUS_STYLE = {
    OPEN: { color: '#4d2e00', bg: '#fdeece' },
    IN_PROGRESS: { color: '#0b3b60', bg: '#dbeafe' },
    RESOLVED: { color: '#0d3d1f', bg: '#dff0e4' },
    CLOSED: { color: '#504e45', bg: '#f3f4ec' },
  };
  function TicketStatusPill(props) {
    var key = String(props.status || '').toUpperCase();
    var s = TICKET_STATUS_STYLE[key] || TICKET_STATUS_STYLE.CLOSED;
    return el('span', { className: 'pa-tkstatus', style: { color: s.color, background: s.bg } },
      key.replace('_', ' '));
  }

  function OpenTicketDialog(props) {
    var s1 = useState(props.categories && props.categories.length ? props.categories[0] : '');
    var category = s1[0]; var setCategory = s1[1];
    var s2 = useState(''); var issue = s2[0]; var setIssue = s2[1];
    var s3 = useState([]); var files = s3[0]; var setFiles = s3[1];
    var s4 = useState(null); var error = s4[0]; var setError = s4[1];
    var s5 = useState(false); var submitting = s5[0]; var setSubmitting = s5[1];
    var fileInput = useRef(null);

    function addFiles(picked) {
      if (!picked) return;
      var next = [];
      for (var i = 0; i < picked.length; i++) {
        var f = picked[i];
        if (!ticketFileOk(f.name, f.type)) { setError(f.name + ': ' + __('unsupported file type.', 'proxyai')); continue; }
        if (f.size > TICKET_MAX_FILE_BYTES) { setError(f.name + ': ' + __('over the 3 MB limit.', 'proxyai')); continue; }
        next.push(f);
      }
      if (next.length) setError(null);
      setFiles(function (cur) { return cur.concat(next).slice(0, TICKET_MAX_FILES); });
      if (fileInput.current) fileInput.current.value = '';
    }

    function submit() {
      if (!issue.trim() || submitting) return;
      setSubmitting(true);
      setError(null);
      var body = new window.FormData();
      body.append('category', category);
      body.append('issue', issue.trim());
      // files[] so PHP keeps every file; the proxy re-emits them as `files`.
      files.forEach(function (f) { body.append('files[]', f); });
      window.fetch(CFG.restUrl + 'proxyai/v1/admin/wordpress/tickets', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'X-WP-Nonce': CFG.restNonce }, body: body,
      }).then(function (r) {
        if (r.ok) { props.onCreated(); props.onClose(); return; }
        return r.json().then(function (d) { d = d || {}; setSubmitting(false);
          setError(d.error === 'file_too_large' ? (d.file || '') + ': ' + __('over the 3 MB limit.', 'proxyai')
            : d.error === 'unsupported_type' ? (d.file || '') + ': ' + __('unsupported file type.', 'proxyai')
            : d.error === 'too_many_files' ? __('Up to 5 files.', 'proxyai')
            : __('Could not submit your ticket. Try again.', 'proxyai'));
        }, function () { setSubmitting(false); setError(__('Could not submit your ticket. Try again.', 'proxyai')); });
      }, function () { setSubmitting(false); setError(__('Could not submit your ticket. Check your connection and try again.', 'proxyai')); });
    }

    return el('div', { className: 'pa-dialog', onClick: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
      el('div', { className: 'pa-dialog__scrim' }),
      el('div', { className: 'pa-dialog__panel pa-ticketdlg', role: 'dialog', 'aria-modal': 'true' },
        el('div', { className: 'pa-tkdialog__head' },
          el('div', { className: 'pa-tkdialog__titles' },
            el('h2', { className: 'pa-tkdialog__title' }, __('Open a ticket', 'proxyai')),
            el('span', { className: 'pa-tkdialog__meta' }, __('Our team replies by email.', 'proxyai'))),
          el('button', { type: 'button', className: 'pa-tkdialog__close', 'aria-label': __('Close', 'proxyai'), onClick: props.onClose }, '✕')),
        el(Field, { label: __('Category', 'proxyai') },
          el(SelectInput, {
            value: category, onChange: setCategory,
            options: (props.categories || []).map(function (c) { return { value: c, label: c }; }),
          })),
        el(Field, { label: __('Your email', 'proxyai') },
          el('input', { className: 'pa-input', value: props.email || '', readOnly: true })),
        el(Field, { label: __('Describe the issue', 'proxyai') },
          el('textarea', {
            className: 'pa-input pa-input--area', rows: 5, maxLength: 5000, value: issue,
            placeholder: __('What happened, and what did you expect?', 'proxyai'),
            onChange: function (e) { setIssue(e.target.value); },
          })),
        el('div', { className: 'pa-ticketdlg__files' },
          el('input', {
            ref: fileInput, type: 'file', multiple: true, accept: TICKET_ACCEPT, className: 'pa-hidden',
            onChange: function (e) { addFiles(e.target.files); },
          }),
          el('button', {
            type: 'button', className: 'pa-btn pa-ticketdlg__upload',
            onClick: function () { if (fileInput.current) fileInput.current.click(); },
          }, '📎 ' + __('Upload supporting documents', 'proxyai')),
          el('span', { className: 'pa-field__hint' },
            __('Up to 5 files, 3 MB each · png, jpg, jpeg, pdf, docx, txt, mp4, mov', 'proxyai')),
          files.map(function (f, i) {
            return el('span', { key: f.name + i, className: 'pa-ticketdlg__file' },
              el('span', { className: 'pa-ticketdlg__filename' }, f.name),
              el('button', {
                type: 'button', className: 'pa-ticketdlg__filex', 'aria-label': __('Remove', 'proxyai'),
                onClick: function () { setFiles(function (cur) { return cur.filter(function (_, idx) { return idx !== i; }); }); },
              }, '✕'));
          })),
        error ? el(Notice, { kind: 'error' }, error) : null,
        el('div', { className: 'pa-ticketdlg__actions' },
          el(Button, { onClick: props.onClose }, __('Cancel', 'proxyai')),
          el(Button, { variant: 'primary', busy: submitting, disabled: !issue.trim(), onClick: submit },
            submitting ? __('Submitting…', 'proxyai') : __('Submit ticket', 'proxyai')))));
  }

  function SupportCard(props) {
    var s1 = useState([]); var rows = s1[0]; var setRows = s1[1];
    var s2 = useState(null); var categories = s2[0]; var setCategories = s2[1];
    var s3 = useState(true); var loading = s3[0]; var setLoading = s3[1];
    var s4 = useState(false); var open = s4[0]; var setOpen = s4[1];

    var load = useCallback(function () {
      return api('wordpress/tickets').then(function (res) {
        setRows((res && res.tickets) || []);
        setCategories((res && res.categories) || []);
        setLoading(false);
      }, function () { setLoading(false); });
    }, []);
    useEffect(function () { load(); }, [load]);

    return el(Card, null,
      el('div', { className: 'pa-supporthead' },
        el('div', { className: 'pa-supporthead__text' },
          // This board is the merchant talking to ProxyAI support, not to
          // their own shoppers.
          el('span', { className: 'pa-supporthead__label' }, __('MY TICKETS', 'proxyai')),
          el('span', { className: 'pa-supporthead__sub' },
            __('This is ProxyAI support, your support to your customer is in Tickets, if you own the Helpdesk add-on', 'proxyai'))),
        el(Button, { variant: 'primary', onClick: function () { setOpen(true); } }, __('Open Ticket', 'proxyai'))),
      loading
        ? el('p', { className: 'pa-support__empty' }, __('Loading…', 'proxyai'))
        : rows.length === 0
          ? el('p', { className: 'pa-support__empty' }, __('No tickets yet.', 'proxyai'))
          : el('table', { className: 'pa-supporttable' },
              el('thead', null, el('tr', null,
                el('th', null, __('TICKET', 'proxyai')),
                el('th', null, __('SUBJECT', 'proxyai')),
                el('th', { className: 'pa-supporttable__date' }, __('DATE', 'proxyai')),
                el('th', null, __('STATUS', 'proxyai')))),
              el('tbody', null, rows.map(function (t) {
                return el('tr', { key: t.id || t.ticketNumber },
                  el('td', { className: 'pa-supporttable__num' }, t.ticketNumber),
                  el('td', { className: 'pa-supporttable__subj' }, t.subject),
                  el('td', { className: 'pa-supporttable__date' }, t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ''),
                  el('td', null, el(TicketStatusPill, { status: t.status })));
              }))),
      open
        ? el(OpenTicketDialog, {
            email: props.email, categories: categories || [],
            onClose: function () { setOpen(false); },
            onCreated: function () { setLoading(true); load(); },
          })
        : null);
  }

  // ------------------------------------------------------------------
  // Settings tab
  // ------------------------------------------------------------------

  function SettingsTab(props) {
    var s1 = useState(null); var alerts = s1[0]; var setAlerts = s1[1];
    var s2 = useState(null); var widgetOn = s2[0]; var setWidgetOn = s2[1];
    var s3 = useState(false); var confirming = s3[0]; var setConfirming = s3[1];
    var s7 = useState(false); var reopening = s7[0]; var setReopening = s7[1];

    useEffect(function () {
      api('wordpress/settings').then(function (res) {
        setAlerts(res.lowBalanceAlertEnabled);
      }, function () {});
      apiFetch({ path: '/proxyai/v1/widget' }).then(function (res) {
        setWidgetOn(!!res.visible);
      }, function () {});
    }, []);

    function saveAlerts(next) {
      var prev = alerts;
      setAlerts(next);
      api('wordpress/settings', { method: 'PATCH', data: { lowBalanceAlertEnabled: next } })
        .catch(function () { setAlerts(prev); });
    }

    function saveWidget(next) {
      var prev = widgetOn;
      setWidgetOn(next);
      apiFetch({ path: '/proxyai/v1/widget', method: 'POST', data: { visible: next } })
        .then(function (res) { setWidgetOn(!!res.visible); }, function () { setWidgetOn(prev); });
    }

    return el(
      Fragment,
      null,
      el(
        Card,
        null,
        el(CardTitle, {
          title: __('Chat widget', 'proxyai'),
          sub: __('Hiding it stops the widget loading for visitors entirely — no script, no request. Everything else is kept.', 'proxyai'),
        }),
        el('div', { className: 'pa-switchrow' },
          el('span', { className: 'pa-switchrow__text' },
            el('span', { className: 'pa-switchrow__label' }, __('Show the widget on my site', 'proxyai')),
            el('span', { className: 'pa-switchrow__sub' }, widgetOn === false
              ? __('Hidden — visitors see no chat button.', 'proxyai')
              : __('Visible to everyone browsing your site.', 'proxyai'))),
          el(Toggle, {
            checked: widgetOn !== false,
            disabled: widgetOn === null,
            onChange: saveWidget,
            label: __('Show the widget on my site', 'proxyai'),
          }))
      ),
      el(
        Card,
        null,
        el(CardTitle, {
          title: __('Notifications', 'proxyai'),
          sub: props.email
            ? __('Sent to', 'proxyai') + ' ' + props.email + '.'
            : __('No address on file — set an administration email in WordPress and reconnect.', 'proxyai'),
        }),
        el('div', { className: 'pa-switchrow' },
          el('span', { className: 'pa-switchrow__text' },
            el('span', { className: 'pa-switchrow__label' }, __('Email me usage alerts', 'proxyai')),
            el('span', { className: 'pa-switchrow__sub' }, __('Get notified when credits fall below $5', 'proxyai'))),
          el(Toggle, {
            checked: alerts !== false,
            disabled: alerts === null || !props.email,
            onChange: saveAlerts,
            label: __('Email me usage alerts', 'proxyai'),
          }))
      ),
      el(SupportCard, { email: props.email }),
      el(
        Card,
        null,
        el(CardTitle, {
          title: __('Setup guide', 'proxyai'),
          sub: __('Reopen the guide to try the chat widget or check your site. Your bot, add-ons and settings are left exactly as they are.', 'proxyai'),
        }),
        el(Button, {
          busy: reopening,
          onClick: function () {
            setReopening(true);
            // Flips a persisted flag; a local-only change would revert on
            // the next load.
            api('wordpress/onboarding', { method: 'DELETE' }).then(
              function () { props.onReload(); },
              function () { setReopening(false); }
            );
          },
        }, __('Reset onboarding', 'proxyai'))
      ),
      el(
        Card,
        null,
        el(CardTitle, {
          title: __('Disconnect', 'proxyai'),
          sub: __('Removes the assistant from this site and deletes its conversations and knowledge base. Your credits and billing history are kept, and reconnecting this site restores the same account.', 'proxyai'),
        }),
        confirming
          ? el('div', { className: 'pa-saverow' },
              el(Button, {
                variant: 'danger',
                onClick: function () { window.location.href = CFG.disconnectUrl; },
              }, __('Yes, disconnect this site', 'proxyai')),
              el(Button, { onClick: function () { setConfirming(false); } }, __('Cancel', 'proxyai')))
          : el(Button, { onClick: function () { setConfirming(true); } }, __('Disconnect this site', 'proxyai'))
      )
    );
  }

  // ------------------------------------------------------------------
  // Onboarding
  // ------------------------------------------------------------------

  /**
   * Dev-only reset for testing first-run. The server is the real gate —
   * production answers 404. On success the browser follows the disconnect
   * action, clearing this site's now-orphaned credentials.
   */
  function DevResetButton() {
    var s1 = useState(false); var armed = s1[0]; var setArmed = s1[1];
    var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
    return el(Button, {
      variant: armed ? 'danger' : undefined,
      busy: busy,
      title: __('Development only. Deletes this site’s pairing, bot, usage and account outright, so the next connect is a first connect.', 'proxyai'),
      onClick: function () {
        if (!armed) { setArmed(true); return; }
        setBusy(true);
        api('wordpress/dev-reset', { method: 'POST' }).then(
          function () { window.location.href = CFG.disconnectUrl; },
          function () { setBusy(false); setArmed(false); }
        );
      },
    }, armed ? __('Delete account — click to confirm', 'proxyai') : 'dev reset');
  }

  function Onboarding(props) {
    var s1 = useState(0); var step = s1[0]; var setStep = s1[1];
    var s2 = useState(false); var finishing = s2[0]; var setFinishing = s2[1];
    var steps = [__('Check your site', 'proxyai'), __('Choose add-ons', 'proxyai'), __('Try it out', 'proxyai')];
    var botName = (props.state.bot && props.state.bot.botName) || __('your assistant', 'proxyai');

    return el(
      'div',
      { className: 'pa-app pa-app--wizard' },
      el('header', { className: 'pa-wizhead' },
        el('h1', { className: 'pa-wizhead__title' }, __('Set up', 'proxyai') + ' ' + botName),
        el('p', { className: 'pa-wizhead__sub' },
          __('Your site’s chatbot is ready. Three short steps and it’s live.', 'proxyai'))),
      el('ol', { className: 'pa-steps' }, steps.map(function (label, i) {
        return el('li', { key: label, className: i <= step ? 'is-active' : '' }, (i + 1) + '. ' + label);
      })),
      step === 0
        ? el(Card, null,
            el(CardTitle, {
              title: __('The widget is already on', 'proxyai'),
              sub: __('The plugin adds the chat bubble to every page of your site — there is no theme edit and no shortcode to place. Open your site in a new tab and you should see it in the corner.', 'proxyai'),
            }),
            el('a', {
              href: props.state.siteUrl, target: '_blank', rel: 'noopener noreferrer',
              className: 'pa-btn pa-btn--primary',
            }, __('Open my site', 'proxyai') + ' ↗'),
            el('p', { className: 'pa-card__fine' },
              __('Not there? A caching plugin or CDN is usually holding an old copy of the page — clear the cache and reload.', 'proxyai')))
        : step === 1
          ? el(Card, null,
              el('div', { className: 'pa-titlerow' },
                el('h2', { className: 'pa-card__title' }, __('Add-ons', 'proxyai')),
                el(LaunchTag, null)),
              el('p', { className: 'pa-card__sub' },
                __('The chatbot itself is free. Add anything you need now, or later from the dashboard.', 'proxyai')),
              el('p', { className: 'pa-card__sub' },
                el('strong', null, __('No subscription.', 'proxyai')),
                ' ' + __('Add-ons are a one-time charge, and each one comes with credits. Credits are what your bot spends as it works — replying, looking things up, searching your content. A typical reply costs around $0.007, so $10 of credit is roughly 1,400 of them. When they run low you top up; nothing renews on its own.', 'proxyai')),
              el(AddonList, {
                state: props.state,
                ownedAddonIds: props.ownedAddonIds,
                onRefresh: props.onRefresh,
                onBuy: props.onBuy,
              }))
          : el(Card, null,
              el(CardTitle, {
                title: __('Give it a try', 'proxyai'),
                sub: __('The chat sits in the corner of your site — open it and ask something a customer would. Everything else lives in this dashboard.', 'proxyai'),
              }),
              el('a', {
                href: props.state.siteUrl, target: '_blank', rel: 'noopener noreferrer',
                className: 'pa-btn pa-btn--primary',
              }, __('Open the chat on my site', 'proxyai') + ' ↗')),
      el('div', { className: 'pa-steprow' },
        el(Button, { disabled: step === 0, onClick: function () { setStep(step - 1); } }, __('Back', 'proxyai')),
        // Never rendered on production — `devReset` is decided by the server.
        props.state.devReset ? el(DevResetButton, null) : null,
        step < steps.length - 1
          ? el(Button, { variant: 'primary', onClick: function () { setStep(step + 1); } }, __('Next', 'proxyai'))
          : el(Button, {
              variant: 'primary', busy: finishing,
              onClick: function () {
                setFinishing(true);
                api('wordpress/onboarding', { method: 'POST' }).then(
                  function () { props.onDone(); },
                  function () { setFinishing(false); }
                );
              },
            }, __('Finish setup', 'proxyai')))
    );
  }

  // ------------------------------------------------------------------
  // App shell
  // ------------------------------------------------------------------

  // Nav order only — add-ons lead the nav, but the landing tab is setup.
  var TABS = [
    { key: 'addons', label: __('Add-ons & credits', 'proxyai') },
    { key: 'configure', label: __('Chatbot setup', 'proxyai') },
    { key: 'inbox', label: __('Agent inbox', 'proxyai') },
    { key: 'tickets', label: __('Tickets', 'proxyai') },
    { key: 'usage', label: __('Usage & costs', 'proxyai') },
    { key: 'rates', label: __('Model rates', 'proxyai') },
    { key: 'settings', label: __('Settings', 'proxyai') },
  ];

  var ADDON_KIND = CFG.addonKinds || {};

  function App() {
    var s1 = useState({ kind: 'loading' }); var status = s1[0]; var setStatus = s1[1];
    var s2 = useState('configure'); var tab = s2[0]; var setTab = s2[1];
    var s3 = useState(null); var checkout = s3[0]; var setCheckout = s3[1];

    var load = useCallback(function () {
      api('wordpress/state').then(
        function (state) {
          // Payment configuration rides the state call, not the page.
          CFG.stripeKey = state.stripePublishableKey || null;
          CFG.paypal = !!state.paypalEnabled;
          CFG.embedBase = state.embedBase || '';
          CFG.runtimeApi = state.runtimeApiUrl || '';
          setStatus(state.clientProductsId && state.bot
            ? { kind: 'ready', state: state }
            : { kind: 'provisioning' });
        },
        function (err) {
          var code = statusOf(err);
          setStatus(code === 401 ? { kind: 'unauthorized' }
            : code === 410 ? { kind: 'gone' }
            : { kind: 'error' });
        }
      );
    }, []);

    useEffect(function () {
      load();
      var onVisible = function () {
        if (document.visibilityState === 'visible') load();
      };
      document.addEventListener('visibilitychange', onVisible);
      return function () { document.removeEventListener('visibilitychange', onVisible); };
    }, [load]);

    if (status.kind === 'loading') return el(Spinner, null);
    if (status.kind === 'provisioning') {
      return el(Notice, { kind: 'info' },
        __('Your site’s chatbot is still being created. Reload this page in a moment.', 'proxyai'));
    }
    if (status.kind === 'unauthorized' || status.kind === 'gone' || status.kind === 'error') {
      return el(Notice, { kind: 'error' },
        __('Could not load your ProxyAI account. Reload the page; if it keeps happening, reconnect from the ProxyAI screen.', 'proxyai'));
    }

    var state = status.state;
    var ownedAddonIds = state.ownedAddonIds || [];
    var fp = state.bot && state.bot.formProps;

    var hasHandoff = fp && fp.purchasedAddons && fp.purchasedAddons.handoff;
    var builtinDesk = false;
    if (fp && fp.initialHelpdesk) {
      (fp.initialHelpdesk.connections || []).forEach(function (c) {
        if (c.provider === 'proxyai' && c.enabled) builtinDesk = true;
      });
    }
    var hasTickets = fp && fp.purchasedAddons && fp.purchasedAddons.helpdesk && builtinDesk;

    var dialogs = checkout
      ? el(CheckoutDialog, {
          intent: checkout,
          balance: Number(state.credits || 0),
          onClose: function () { setCheckout(null); },
          onPaid: function () { setCheckout(null); load(); },
        })
      : null;

    if (!state.onboardingCompleted) {
      return el(Fragment, null, dialogs, el(Onboarding, {
        state: state,
        ownedAddonIds: ownedAddonIds,
        onRefresh: function () { return Promise.resolve(load()); },
        onBuy: setCheckout,
        onDone: load,
      }));
    }

    return el(
      'div',
      { className: 'pa-app' },
      dialogs,
      el(
        'header',
        { className: 'pa-header' },
        el('div', null,
          el('h1', { className: 'pa-header__name' }, (state.bot && state.bot.botName) || 'ProxyAI'),
          el('span', { className: 'pa-header__site' }, state.siteUrl)),
        el('div', { className: 'pa-header__right' },
          el(AgentAvatar, {
            name: (state.agent && state.agent.name) || '',
            initialUrl: state.agent && state.agent.avatarUrl,
          }),
          el('div', { className: 'pa-header__balance' },
            el('span', { className: 'pa-header__balancelabel' }, __('Credit balance', 'proxyai')),
            el('strong', null, '$' + Number(state.credits || 0).toFixed(2))),
          el('button', {
            type: 'button',
            className: 'pa-plus',
            'aria-label': __('Add credits', 'proxyai'),
            onClick: function () { setCheckout({ kind: 'topup' }); },
          }, '+'))
      ),
      el(SpendPanel, null),
      el('nav', { className: 'pa-tabs' },
        TABS.filter(function (t) { return t.key !== 'tickets' || hasTickets; }).map(function (t) {
          return el('button', {
            key: t.key,
            type: 'button',
            className: 'pa-tab' + (tab === t.key ? ' is-active' : ''),
            onClick: function () { setTab(t.key); },
          }, t.label);
        })),
      tab === 'configure' ? el(ConfigTab, {
        botId: state.clientProductsId,
        formProps: fp,
        onNavigate: setTab,
        oauth: state.oauth || {},
        webhookBase: state.webhookBase || (CFG.appUrl || ''),
        // Store actions need WooCommerce detected AND the WooCommerce Store
        // add-on — matched by kind or by the stable product id, since the
        // server does not always emit catalog[].kind.
        hasStoreActions: state.hasWooCommerce && (
          ownedAddonIds.indexOf('woo-store') !== -1 ||
          state.catalog.some(function (a) {
            return a.kind === 'wooStore' && ownedAddonIds.indexOf(a.id) !== -1;
          })
        ),
      }) : null,
      tab === 'addons' ? el(AddonsTab, {
        state: state, ownedAddonIds: ownedAddonIds,
        onRefresh: function () { return Promise.resolve(load()); },
        onBuy: setCheckout,
      }) : null,
      tab === 'inbox' ? el(InboxTab, {
        botId: state.clientProductsId,
        hasHandoff: hasHandoff,
        state: state,
        onRefresh: function () { return Promise.resolve(load()); },
        onBuy: setCheckout,
      }) : null,
      tab === 'tickets' && hasTickets ? el(TicketsTab, { botId: state.clientProductsId, hasTickets: hasTickets }) : null,
      tab === 'usage' ? el(UsageTab, { botId: state.clientProductsId }) : null,
      tab === 'rates' ? el(RatesTab, null) : null,
      tab === 'settings' ? el(SettingsTab, { email: state.agent && state.agent.email, onReload: load }) : null,
      el('footer', { className: 'pa-footer' },
        el('span', null, __('ProxyAI plugin', 'proxyai') + ' ' + (CFG.version || '')),
        state.hasWooCommerce
          ? el(Fragment, null, el('span', { 'aria-hidden': 'true' }, '·'),
              el('span', null, __('WooCommerce detected', 'proxyai')))
          : null,
        el('span', { 'aria-hidden': 'true' }, '·'),
        el('a', { href: (CFG.appUrl || '') + '/terms', target: '_blank', rel: 'noopener noreferrer' },
          __('Terms of Service', 'proxyai')),
        el('a', { href: (CFG.appUrl || '') + '/privacy', target: '_blank', rel: 'noopener noreferrer' },
          __('Privacy Policy', 'proxyai')),
        el('a', { href: (CFG.appUrl || '') + '/service-agreement', target: '_blank', rel: 'noopener noreferrer' },
          __('Service Agreement', 'proxyai')))
    );
  }

  var mount = document.getElementById('proxyai-dashboard');
  if (mount) {
    if (element.createRoot) {
      element.createRoot(mount).render(el(App, null));
    } else {
      element.render(el(App, null), mount);
    }
  }
})(window.wp);
