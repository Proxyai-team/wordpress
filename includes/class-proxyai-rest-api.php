<?php
/**
 * The plugin's own REST surface: the pairing callback.
 *
 * Guest order lookup shares the namespace but lives in its own file.
 *
 * @package ProxyAI
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers the plugin's REST routes, starting with the pairing callback.
 */
final class ProxyAI_Rest_Api {

	public const NAMESPACE = 'proxyai/v1';

	/**
	 * Hooks route registration into rest_api_init.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Registers the /confirm pairing route.
	 */
	public static function routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/confirm',
			array(
				'methods'             => 'POST',
				// Public by design — see confirm().
				'permission_callback' => '__return_true',
				'callback'            => array( self::class, 'confirm' ),
				'args'                => array(
					'nonce' => array(
						'required'          => true,
						'type'              => 'string',
						/**
						 * Charset matters, not just length: this endpoint returns
						 * HMAC(nonce, secret) to anyone, and the same secret signs
						 * `signed_post` bodies (which are JSON, so they always
						 * contain `{`, `"` and `:`). Restricting the nonce to
						 * UUID-shaped input keeps the two languages disjoint, so no
						 * oracle answer can be replayed as a valid body signature.
						 * Do not widen this.
						 */
						'validate_callback' => static fn( $value ): bool => is_string( $value )
							&& preg_match( '/\A[A-Za-z0-9-]{16,128}\z/', $value ) === 1,
					),
				),
			)
		);
	}

	/**
	 * Proves this site holds the secret it just sent to ProxyAI: ProxyAI calls
	 * back during pairing with a fresh nonce and compares the digest.
	 *
	 * Unauthenticated on purpose — it reveals only an HMAC of a caller-chosen
	 * value, worthless without the secret, and pairing is what establishes the
	 * credential in the first place.
	 *
	 * Answers 404 rather than 401 when there is no secret, so an unpaired site
	 * cannot be probed for the plugin.
	 *
	 * @param WP_REST_Request $request The incoming request.
	 * @return WP_REST_Response|WP_Error The signature payload, or 404 when unpaired.
	 */
	public static function confirm( WP_REST_Request $request ) {
		$signature = ProxyAI_Connection::sign( (string) $request->get_param( 'nonce' ) );
		if ( '' === $signature ) {
			return new WP_Error( 'not_found', __( 'Not found.', 'proxyai' ), array( 'status' => 404 ) );
		}
		return new WP_REST_Response( array( 'signature' => $signature ), 200 );
	}
}
