<?php
/**
 * Keeps the assistant's knowledge base in step with site content.
 *
 * Two paths: a full crawl batched through WP-Cron, and incremental updates on
 * save/delete. Both are gated on the Knowledge add-on — without it the hooks
 * are never registered and no content is sent.
 *
 * @package ProxyAI
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Syncs published content to the assistant's knowledge base.
 */
final class ProxyAI_Content_Sync {

	public const OPTION_KNOWLEDGE = 'proxyai_has_knowledge';
	public const OPTION_QUEUE     = 'proxyai_sync_queue';

	private const EVENT_FLUSH = 'proxyai_sync_flush';
	private const EVENT_CRAWL = 'proxyai_sync_crawl';

	/** Post types worth answering questions from. */
	private const POST_TYPES = array( 'post', 'page', 'product' );

	/** How long a save waits before it is sent, so an editing session is one sync. */
	private const DEBOUNCE_SECONDS = 120;

	/** Documents per request. The service refuses a larger batch. */
	private const BATCH_SIZE = 20;

	/**
	 * Hooks cron events, and the save/delete listeners when syncing is on.
	 */
	public static function register(): void {
		add_action( self::EVENT_FLUSH, array( self::class, 'flush' ) );
		add_action( self::EVENT_CRAWL, array( self::class, 'crawl_batch' ), 10, 1 );

		if ( ! ProxyAI_Connection::is_connected() || ! self::has_knowledge() ) {
			return;
		}

		add_action( 'save_post', array( self::class, 'on_save' ), 10, 3 );
		add_action( 'deleted_post', array( self::class, 'on_delete' ), 10, 2 );
		// Trashed posts must stop being answerable; `deleted_post` only fires
		// on permanent deletion.
		add_action( 'wp_trash_post', array( self::class, 'on_trash' ) );
	}

	/**
	 * Whether this site owns the Knowledge add-on.
	 *
	 * @return bool Whether the add-on is owned.
	 */
	public static function has_knowledge(): bool {
		return get_option( self::OPTION_KNOWLEDGE, '0' ) === '1';
	}

	/**
	 * Add-on ownership; syncing without it would build an undeliverable backlog.
	 *
	 * @param bool $owned Whether the add-on is owned.
	 */
	public static function set_knowledge( bool $owned ): void {
		update_option( self::OPTION_KNOWLEDGE, $owned ? '1' : '0', false );
	}

	/**
	 * Queues a post, debounced. An option, not a transient — a cache flush
	 * must not drop pending work.
	 *
	 * @param int|string   $post_id The saved post's ID.
	 * @param WP_Post|null $post    The saved post, when the hook provides it.
	 * @param bool|null    $update  Whether this is an update (unused).
	 */
	public static function on_save( $post_id, $post = null, $update = null ): void { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- save_post hook signature.
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}
		$post = $post ? $post : get_post( $post_id );
		if ( ! $post instanceof WP_Post || ! self::is_syncable( $post ) ) {
			return;
		}
		self::enqueue( 'save', (string) get_permalink( $post ) );
	}

	/**
	 * Queues a delete so the document stops being answerable.
	 *
	 * @param int|string   $post_id The deleted post's ID.
	 * @param WP_Post|null $post    The deleted post, when the hook provides it.
	 */
	public static function on_delete( $post_id, $post = null ): void {
		$post = $post ? $post : get_post( $post_id );
		if ( ! $post instanceof WP_Post || ! in_array( $post->post_type, self::POST_TYPES, true ) ) {
			return;
		}
		// Resolve the permalink before the row disappears; afterwards it
		// returns a `?p=` fallback that never matches what was ingested.
		self::enqueue( 'delete', (string) get_permalink( $post ) );
	}

	/**
	 * Treats a trashed post as deleted.
	 *
	 * @param int|string $post_id The trashed post's ID.
	 */
	public static function on_trash( $post_id ): void {
		self::on_delete( $post_id );
	}

	/**
	 * Whether a post is public content the assistant may ingest.
	 *
	 * @param WP_Post $post The post to test.
	 * @return bool Whether the post should be synced.
	 */
	private static function is_syncable( WP_Post $post ): bool {
		return 'publish' === $post->post_status
			&& in_array( $post->post_type, self::POST_TYPES, true )
			// A password-protected post is not public content; its body would
			// end up quoted to anyone who asked.
			&& '' === $post->post_password
			&& ! self::is_woocommerce_utility_page( $post );
	}

	/**
	 * WooCommerce's cart, checkout and account pages hold blocks that fatal
	 * when rendered from cron, and carry no answerable content anyway.
	 *
	 * @param WP_Post $post The post to test.
	 * @return bool Whether the post is one of those pages.
	 */
	private static function is_woocommerce_utility_page( WP_Post $post ): bool {
		if ( ! function_exists( 'wc_get_page_id' ) ) {
			return false;
		}
		foreach ( array( 'cart', 'checkout', 'myaccount' ) as $page ) {
			if ( (int) wc_get_page_id( $page ) === (int) $post->ID ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Adds one URL to the pending queue and schedules the debounced flush.
	 *
	 * @param string $action Either 'save' or 'delete'.
	 * @param string $url    The post's permalink.
	 */
	private static function enqueue( string $action, string $url ): void {
		if ( '' === $url ) {
			return;
		}
		$queue = get_option( self::OPTION_QUEUE, array() );
		if ( ! is_array( $queue ) ) {
			$queue = array();
		}
		// Keyed by URL: repeated saves collapse to one entry, and a delete
		// after a save replaces it rather than racing it.
		$queue[ $url ] = $action;
		update_option( self::OPTION_QUEUE, $queue, false );

		if ( ! wp_next_scheduled( self::EVENT_FLUSH ) ) {
			wp_schedule_single_event( time() + self::DEBOUNCE_SECONDS, self::EVENT_FLUSH );
		}
	}

	/**
	 * Sends the debounce window's queue. Cleared before the request so retries
	 * cannot grow it unboundedly; a lost update is recoverable by the next
	 * save or a full crawl.
	 */
	public static function flush(): void {
		$queue = get_option( self::OPTION_QUEUE, array() );
		if ( ! is_array( $queue ) || array() === $queue ) {
			return;
		}
		delete_option( self::OPTION_QUEUE );

		$documents = array();
		$deleted   = array();
		foreach ( array_slice( $queue, 0, self::BATCH_SIZE, true ) as $url => $action ) {
			if ( 'delete' === $action ) {
				$deleted[] = $url;
				continue;
			}
			$document = self::document_for( $url );
			if ( null !== $document ) {
				$documents[] = $document;
			}
		}

		self::send( $documents, $deleted );

		// Anything past the batch limit goes round again rather than being dropped.
		$remaining = array_slice( $queue, self::BATCH_SIZE, null, true );
		if ( array() !== $remaining ) {
			update_option( self::OPTION_QUEUE, $remaining, false );
			wp_schedule_single_event( time() + 60, self::EVENT_FLUSH );
		}
	}

	/**
	 * Starts a full walk of published content, batched through WP-Cron;
	 * inline it could outrun the request time limit on a large archive.
	 */
	public static function start_crawl(): void {
		wp_schedule_single_event( time() + 10, self::EVENT_CRAWL, array( 0 ) );
	}

	/**
	 * One page of the walk, which then schedules the next. Fetches IDs only,
	 * ordered by ID so an offset means the same thing on the next run.
	 *
	 * @param int $offset How many posts to skip.
	 */
	public static function crawl_batch( $offset = 0 ): void {
		if ( ! ProxyAI_Connection::is_connected() || ! self::has_knowledge() ) {
			return;
		}
		$offset = max( 0, (int) $offset );

		$ids = get_posts(
			array(
				'post_type'      => self::POST_TYPES,
				'post_status'    => 'publish',
				'has_password'   => false,
				'posts_per_page' => self::BATCH_SIZE,
				'offset'         => $offset,
				'orderby'        => 'ID',
				'order'          => 'ASC',
				'fields'         => 'ids',
			)
		);
		if ( ! is_array( $ids ) || array() === $ids ) {
			return;
		}

		$documents = array();
		foreach ( $ids as $id ) {
			$document = self::document_for( (string) get_permalink( (int) $id ), (int) $id );
			if ( null !== $document ) {
				$documents[] = $document;
			}
		}
		self::send( $documents, array() );

		if ( count( $ids ) === self::BATCH_SIZE ) {
			// A minute between batches so the crawl never slows the site.
			wp_schedule_single_event( time() + 60, self::EVENT_CRAWL, array( $offset + self::BATCH_SIZE ) );
		}
	}

	/**
	 * Renders a post as plain text: the_content applied (blocks otherwise
	 * ingest as HTML comments), then tags stripped.
	 *
	 * @param string   $url     The post's permalink.
	 * @param int|null $post_id The post ID, when known; resolved from the URL otherwise.
	 * @return array{url:string,title:string,content:string}|null
	 */
	private static function document_for( string $url, ?int $post_id = null ): ?array {
		$post = null !== $post_id ? get_post( $post_id ) : get_post( url_to_postid( $url ) );
		if ( ! $post instanceof WP_Post || ! self::is_syncable( $post ) ) {
			return null;
		}

		try {
			// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- core filter, not a new hook.
			$rendered = apply_filters( 'the_content', $post->post_content );
		} catch ( \Throwable $e ) {
			// A block that cannot render from cron costs one document, not the
			// whole crawl.
			return null;
		}
		$text = trim( wp_strip_all_tags( (string) $rendered, true ) );
		if ( '' === $text ) {
			return null;
		}

		/** Filter seam: exclude a post type, redact, or drop (return null). */
		return apply_filters(
			'proxyai_sync_document',
			array(
				'url'     => $url,
				'title'   => get_the_title( $post ),
				'content' => $text,
			),
			$post
		);
	}

	/**
	 * Posts the batch to ProxyAI and refreshes the entitlement flag.
	 *
	 * @param array<int,array{url:string,title:string,content:string}> $documents Documents to upsert.
	 * @param array<int,string>                                        $deleted   URLs to remove.
	 */
	private static function send( array $documents, array $deleted ): void {
		if ( array() === $documents && array() === $deleted ) {
			return;
		}
		$response = ProxyAI_Connection::signed_post(
			'/api/wordpress/sync',
			array(
				'documents' => array_values( array_filter( $documents ) ),
				'deleted'   => array_values( $deleted ),
			)
		);

		// The response carries the current entitlement, so a lapsed add-on
		// turns the hooks off at the next attempt.
		if ( is_array( $response ) && array_key_exists( 'knowledge', $response ) ) {
			self::set_knowledge( (bool) $response['knowledge'] );
		}
	}
}
