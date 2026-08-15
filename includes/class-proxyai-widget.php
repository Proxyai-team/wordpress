<?php
/**
 * Front-end widget delivery.
 *
 * The loader is served by ProxyAI rather than bundled here because the widget
 * and its service are versioned together.
 *
 * @package ProxyAI
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Enqueues the ProxyAI widget loader and ticket-form embeds on the front end.
 */
final class ProxyAI_Widget {

	/**
	 * Attributes to print on our script tags, keyed by handle.
	 *
	 * @var array<string,array<string,string>>
	 */
	private static array $script_attributes = array();

	/**
	 * Hooks the widget's actions, filters, shortcode and block.
	 */
	public static function register(): void {
		add_action( 'wp_enqueue_scripts', array( self::class, 'enqueue' ) );
		add_filter( 'script_loader_tag', array( self::class, 'add_embed_attributes' ), 10, 2 );
		// [proxyai_tickets] — the embedded support-ticket form; also available
		// as a block. Both render through the same function.
		add_shortcode( 'proxyai_tickets', array( self::class, 'tickets_shortcode' ) );
		add_action( 'init', array( self::class, 'register_blocks' ) );
	}

	/**
	 * Registers the "ProxyAI Support Tickets" block.
	 *
	 * Server-rendered: the identity token is minted per request and must never
	 * be saved into post content, where it would be served to every visitor.
	 */
	public static function register_blocks(): void {
		if ( ! function_exists( 'register_block_type' ) ) {
			return;
		}
		wp_register_script(
			'proxyai-tickets-block',
			PROXYAI_PLUGIN_URL . 'admin/js/tickets-block.js',
			array( 'wp-blocks', 'wp-element', 'wp-block-editor' ),
			PROXYAI_VERSION,
			true
		);
		register_block_type(
			'proxyai/tickets',
			array(
				'api_version'     => 3,
				'title'           => 'ProxyAI Support Tickets',
				'description'     => 'A support-ticket form your signed-in customers can use without chatting to the bot.',
				'category'        => 'widgets',
				'icon'            => 'sos',
				'supports'        => array(
					'html'     => false,
					'multiple' => false,
				),
				'editor_script'   => 'proxyai-tickets-block',
				'render_callback' => array( self::class, 'tickets_shortcode' ),
			)
		);
	}

	/**
	 * Renders the [proxyai_tickets] container and enqueues the form script.
	 * Enqueued at render time so the script only loads on pages showing the form.
	 */
	public static function tickets_shortcode(): string {
		if ( ! ProxyAI_Connection::is_enabled() ) {
			return '';
		}
		$bot_id = ProxyAI_Connection::bot_id();
		if ( '' === $bot_id ) {
			return '';
		}

		wp_enqueue_script(
			'proxyai-ticket-embed',
			PROXYAI_APP_URL . '/ticket-embed.js',
			array(),
			PROXYAI_VERSION,
			true
		);

		$attributes    = array(
			'data-bot-id'  => $bot_id,
			'data-api'     => ProxyAI_Connection::runtime_url(),
			'data-target'  => '#proxyai-tickets',
			// Rocket Loader opt-out: a rewritten type leaves
			// document.currentScript null and the form never mounts.
			'data-cfasync' => 'false',
		);
		$visitor_token = ProxyAI_Connection::mint_visitor_token();
		if ( '' !== $visitor_token ) {
			$attributes['data-user-token'] = $visitor_token;
		}
		self::$script_attributes['proxyai-ticket-embed'] = $attributes;

		return '<div id="proxyai-tickets"></div>';
	}

	/**
	 * Prints our data- attributes on the script tag via script_loader_tag;
	 * wp_script_add_data's 'attributes' key is not honoured for these.
	 *
	 * @param string $tag    The complete script tag HTML.
	 * @param string $handle The script's registered handle.
	 * @return string The (possibly modified) script tag.
	 */
	public static function add_embed_attributes( $tag, $handle ) {
		if ( ! isset( self::$script_attributes[ $handle ] ) ) {
			return $tag;
		}
		$attributes = '';
		foreach ( self::$script_attributes[ $handle ] as $name => $value ) {
			$attributes .= sprintf( ' %s="%s"', esc_attr( $name ), esc_attr( $value ) );
		}
		return str_replace( '<script ', '<script' . $attributes . ' ', $tag );
	}

	/**
	 * Enqueues the widget loader and, with WooCommerce present, the cart bridge.
	 */
	public static function enqueue(): void {
		// Front end only: the widget must not appear over admin screens.
		if ( is_admin() || ! ProxyAI_Connection::is_enabled() ) {
			return;
		}

		$bot_id = ProxyAI_Connection::bot_id();
		if ( '' === $bot_id ) {
			return;
		}

		wp_enqueue_script(
			'proxyai-embed',
			PROXYAI_APP_URL . '/embed.js',
			array(),
			PROXYAI_VERSION,
			true
		);

		self::$script_attributes['proxyai-embed'] = array(
			'data-bot-id'  => $bot_id,
			'data-api'     => ProxyAI_Connection::runtime_url(),
			// Rocket Loader opt-out: a rewritten `type` leaves
			// document.currentScript null and stops the widget loading.
			'data-cfasync' => 'false',
		);

		// Signed identity token for logged-in visitors (required by the ticket
		// flow). Minted server-side so the browser never sees the secret;
		// empty for anonymous visitors.
		$visitor_token = ProxyAI_Connection::mint_visitor_token();
		if ( '' !== $visitor_token ) {
			self::$script_attributes['proxyai-embed']['data-user-token'] = $visitor_token;
		}

		// Cart bridge requires WooCommerce; without it the assistant degrades
		// to a plain chatbot.
		if ( ! class_exists( 'WooCommerce' ) ) {
			return;
		}

		/** Filter: disable the cart bridge without disabling the assistant. */
		if ( ! apply_filters( 'proxyai_enable_woo_cart', true ) ) {
			return;
		}

		wp_enqueue_script(
			'proxyai-woo-cart',
			PROXYAI_APP_URL . '/woo-cart.js',
			array( 'proxyai-embed' ),
			PROXYAI_VERSION,
			true
		);

		// Rocket Loader opt-out again: deferred re-execution can run this
		// after the widget has already looked for it.
		self::$script_attributes['proxyai-woo-cart'] = array( 'data-cfasync' => 'false' );

		// Not wp_localize_script: it casts every value to a string, which
		// would break the numeric max_quantity.
		wp_add_inline_script(
			'proxyai-woo-cart',
			'window.ProxyAIWooConfig = ' . wp_json_encode(
				array(
					'nonce'        => wp_create_nonce( 'wc_store_api' ),
					'cart_url'     => wc_get_cart_url(),
					'checkout_url' => wc_get_checkout_url(),
					// Upper bound on a single add-to-cart, enforced in the browser.
					'max_quantity' => 100,
				)
			) . ';',
			'before'
		);
	}
}
