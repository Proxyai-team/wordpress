<?php
/**
 * Guest order tracking. The one endpoint that returns customer data, so most
 * of this file is refusal logic.
 *
 * @package ProxyAI
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Signed guest order lookup endpoint with uniform failure responses.
 */
final class ProxyAI_Order_Lookup {

	/** Failures allowed for one email address inside the window before it is refused. */
	private const RATE_LIMIT  = 10;
	private const RATE_WINDOW = 600;

	/**
	 * Hooks route registration into rest_api_init.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Registers the /order-lookup route.
	 */
	public static function routes(): void {
		register_rest_route(
			ProxyAI_Rest_Api::NAMESPACE,
			'/order-lookup',
			array(
				'methods'             => 'POST',
				// Authentication is the HMAC over the raw body, checked inside the
				// callback where that exact body is available.
				'permission_callback' => '__return_true',
				'callback'            => array( self::class, 'lookup' ),
			)
		);
	}

	/**
	 * Looks up one order by number + email. Three required properties: only
	 * ProxyAI can call it (body signed with the site secret); failure is
	 * uniform (unknown order and wrong email are indistinguishable); output
	 * is a fixed allow-list.
	 *
	 * @param WP_REST_Request $request The incoming request.
	 * @return WP_REST_Response|WP_Error Order summary, or a refusal.
	 */
	public static function lookup( WP_REST_Request $request ) {
		if ( ! class_exists( 'WooCommerce' ) ) {
			return self::not_found();
		}

		$raw = $request->get_body();
		if ( ! self::verify_signature( $raw, (string) $request->get_header( 'x-proxyai-signature' ) ) ) {
			return new WP_Error( 'unauthorized', __( 'Unauthorized.', 'proxyai' ), array( 'status' => 401 ) );
		}

		$body = json_decode( $raw, true );
		if ( ! is_array( $body ) ) {
			return self::not_found();
		}

		$order_id = isset( $body['order_id'] ) ? absint( $body['order_id'] ) : 0;
		$email    = isset( $body['billing_email'] ) ? (string) $body['billing_email'] : '';
		if ( 0 === $order_id || '' === $email ) {
			return self::not_found();
		}

		// Throttle keyed on the supplied email, not the caller IP: every
		// request arrives from ProxyAI's server, so an IP bucket would be one
		// bucket for the whole store. Keying on email still caps enumeration
		// while isolating shoppers.
		if ( self::rate_limited( $email ) ) {
			return new WP_Error( 'too_many_requests', __( 'Too many requests.', 'proxyai' ), array( 'status' => 429 ) );
		}

		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			self::count_failure( $email );
			return self::not_found();
		}

		// Normalised, then compared in constant time: a plain `===` leaks
		// through timing how much of a guessed address was right.
		$expected = strtolower( trim( (string) $order->get_billing_email() ) );
		$supplied = strtolower( trim( $email ) );
		if ( '' === $expected || ! hash_equals( $expected, $supplied ) ) {
			self::count_failure( $email );
			return self::not_found();
		}

		return new WP_REST_Response( self::render( $order ), 200 );
	}

	/**
	 * Builds the allow-listed order summary returned to ProxyAI.
	 *
	 * @param WC_Order $order The matched order.
	 * @return array<string,mixed>
	 */
	private static function render( WC_Order $order ): array {
		$items = array();
		foreach ( $order->get_items() as $item ) {
			$items[] = array(
				'name'     => $item->get_name(),
				'quantity' => $item->get_quantity(),
				'total'    => wc_format_decimal( $item->get_total(), wc_get_price_decimals() ),
			);
		}

		$shipments = array();
		// Tracking is not core WooCommerce; the common plugins store it as
		// order meta under these keys, and anything else is simply absent.
		$tracking_number = (string) $order->get_meta( '_tracking_number' );
		$tracking_url    = (string) $order->get_meta( '_tracking_url' );
		if ( '' !== $tracking_number ) {
			$carrier     = (string) $order->get_meta( '_tracking_provider' );
			$shipments[] = array_filter(
				array(
					'tracking_number' => $tracking_number,
					'tracking_url'    => '' !== $tracking_url ? $tracking_url : null,
					'carrier'         => '' !== $carrier ? $carrier : null,
				)
			);
		}

		return array(
			'found'        => true,
			'order_id'     => $order->get_id(),
			'order_number' => $order->get_order_number(),
			// The merchant's own (possibly translated/renamed) status label.
			'status'       => wc_get_order_status_name( $order->get_status() ),
			'date_created' => $order->get_date_created() ? $order->get_date_created()->date( 'Y-m-d' ) : null,
			'total'        => wc_format_decimal( $order->get_total(), wc_get_price_decimals() ),
			'currency'     => $order->get_currency(),
			'items'        => $items,
			'shipments'    => $shipments,
		);
	}

	/** The single failure answer: one shape, one status, on every path. */
	private static function not_found() {
		return new WP_REST_Response( array( 'found' => false ), 404 );
	}

	/**
	 * Checks the request body's HMAC against the site secret.
	 *
	 * @param string $raw      The raw request body.
	 * @param string $provided The signature header value.
	 * @return bool Whether the signature is valid.
	 */
	private static function verify_signature( string $raw, string $provided ): bool {
		if ( '' === $raw || '' === $provided ) {
			return false;
		}
		$expected = ProxyAI_Connection::sign( $raw );
		return '' !== $expected && hash_equals( $expected, trim( $provided ) );
	}

	/**
	 * Per-email throttle on *failed* lookups only — walking order numbers is
	 * nothing but failures. A transient, so it expires on its own.
	 *
	 * @param string $email The supplied billing email.
	 * @return bool Whether this email has exceeded the failure limit.
	 */
	private static function rate_limited( string $email ): bool {
		return (int) get_transient( self::rate_key( $email ) ) >= self::RATE_LIMIT;
	}

	/**
	 * Records one failed lookup against the email's throttle bucket.
	 *
	 * @param string $email The supplied billing email.
	 */
	private static function count_failure( string $email ): void {
		$key   = self::rate_key( $email );
		$count = (int) get_transient( $key );
		set_transient( $key, $count + 1, self::RATE_WINDOW );
	}

	/**
	 * Builds the transient key for an email's throttle bucket.
	 *
	 * @param string $email The supplied billing email.
	 * @return string The transient key.
	 */
	private static function rate_key( string $email ): string {
		// Normalised the same way the lookup compares it. The email is only
		// ever hashed into a transient key, never stored or echoed.
		return 'proxyai_ol_' . md5( strtolower( trim( $email ) ) );
	}
}
