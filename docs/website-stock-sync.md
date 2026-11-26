# Website Stock Sync (WooCommerce)

Pushes the ERP's stock to the two WooCommerce shops (`www.smartlife-vn.com`,
`b2b.smartlife-vn.com`). It is **one-way and manual**:

- the ERP is the only source of truth - nothing a website does writes back;
- nothing runs on a timer. An operator presses **Sync now** on `/website-sync`;
- a website order therefore does **not** reduce ERP stock yet. Website sales are a later phase.

## Setting it up (once per shop)

1. **Encryption key.** Add `INTEGRATION_SECRET_KEY` to `.env` (16+ characters, any passphrase)
   and restart the server. It encrypts each shop's API key at rest (AES-256-GCM). Rotating it
   makes stored keys unreadable until they are re-entered - that is the point.
2. **WooCommerce key.** One key pair per shop - see [Getting the key](#getting-the-woocommerce-key)
   below. The secret is shown once, on the screen that creates it.
3. **Add the website** on `/website-sync`: name, address (`https://www.smartlife-vn.com`), key,
   secret. Press **Test** - a 404 there means the shop has no WooCommerce REST API at all (see
   [Plain permalinks](#plain-permalinks), which the ERP handles by itself).
4. **Refresh catalogue.** This reads the shop's products (and each variation of a variable
   product), matches `sku` against `products.sku`, and records the link. Anything it cannot match
   is listed as *unmapped* - fix the SKU on one side, then refresh again. Until this runs, a
   preview shows "No SKUs are linked yet".

## Getting the WooCommerce key

The consumer key/secret pair is a WordPress user credential for the REST API, created inside the
shop's own wp-admin. **`www.smartlife-vn.com` and `b2b.smartlife-vn.com` are two separate WordPress
installs**, so each needs its own pair - a key from one is rejected by the other with
`refused the API key (401/403)`.

For each shop:

1. Log in to that shop's wp-admin as an **administrator** (shop managers can see the screen but
   cannot create keys) at `https://www.smartlife-vn.com/wp-admin` or
   `https://b2b.smartlife-vn.com/wp-admin`.
2. Go to **WooCommerce → Settings → Advanced → REST API**.
3. Press **Add key**. Fill in:
   - **Description** - a label for later, e.g. `Pet ERP stock sync`.
   - **User** - the admin account whose permissions the key inherits.
   - **Permissions** - **Read/Write**. Read-only fails on the first push; it may still pass
     **Test**, which is a GET.
4. Press **Generate API key**. The next screen shows two values, and **the secret is only ever shown
   on this screen**:
   - **Consumer key** - starts with `ck_` (this is `consumer_key`),
   - **Consumer secret** - starts with `cs_` (this is `consumer_secret`).
5. Copy both straight into the ERP: `/website-sync` → name, address (the bare
   `https://www.smartlife-vn.com`, no `/wp-json`), consumer key, consumer secret → **Save**, then
   **Test**. If you leave the page first you must delete the key and generate a new pair.

Notes:

- **HTTPS is required.** WooCommerce hides the *Add key* button, and the REST API itself, when
  *Settings → General* has an `http://` site address. Both shops are on HTTPS already - if the
  button is missing, check that first.
- *Settings → Permalinks* does not have to change. The ERP calls `/wp-json/wc/v3/...` first and, if
  that 404s, retries the same route as `/?rest_route=/wc/v3/...`, which WordPress serves even on
  "Plain" permalinks - a 404 from both is what the error table below means. **Test** says which
  shape answered; see [Plain permalinks](#plain-permalinks). A `401` gets the same treatment with
  the key in the query string, for hosts that strip the `Authorization` header; see
  [a server that drops the Authorization header](#a-server-that-drops-the-authorization-header).
- To revoke access, return to the same screen, tick the key and **Revoke** (or delete it). Do that
  if a key is pasted into the wrong environment - then generate a new pair and re-enter it on the
  channel.
- A key created before WooCommerce 3.5 has no prefix (`ck_`/`cs_` added in 3.5); the ERP accepts
  either shape. If a shop is older than that, upgrade WooCommerce rather than adapting the ERP.

## Plain permalinks

A WordPress shop with *Settings → Permalinks* set to **Plain** has no `/wp-json/` prefix, so
`https://shop.example/wp-json/wc/v3/products` is a 404 even though WooCommerce is installed and the
key is fine. The same routes still answer at
`https://shop.example/?rest_route=/wc/v3/products`, so the client probes that shape on a 404 and
remembers it for the process (`server/woocommerce/client.ts`):

- **Test** reports *"Permalinks are set to Plain, so the ?rest_route= address is used"* - that is
  information, not an error. Everything else works unchanged.
- The client re-probes from the pretty path whenever the server restarts, or when a channel's
  address is edited, so switching permalinks later needs no action on this side.
- Only when **both** shapes 404 does the channel fail, and then the shop is the problem: a plugin
  or security rule blocking `/wp-json/` and the `rest_route` query, WooCommerce deactivated, or the
  address pointing somewhere that is not WordPress.
- Changing permalinks is optional. On a live shop it rewrites product URLs
  (`?product=` → `/product/...`), which is a separate decision from letting the ERP in.

## A server that drops the `Authorization` header

`b2b.smartlife-vn.com` answers `401 woocommerce_rest_cannot_view` — *"Sorry, you cannot list
resources"* — to a **valid** key, because its nginx/php setup does not pass the `Authorization`
header through to PHP, so WordPress sees an anonymous request. The same key sent as
`?consumer_key=…&consumer_secret=…` returns `200` from the identical URL (verified against the live
shop, 58 products). Nothing is wrong with the key, so "check the key" is the wrong advice.

How the client handles it (`server/woocommerce/client.ts`):

- The header is always tried first. On a `401`/`403` the request is repeated **once** with the key in
  the query string; only that answer decides. If it succeeds the mode is remembered for the process,
  like the permalinks fallback, and cleared when the channel's address is edited or the server
  restarts.
- **Test** then reports *"The shop's web server drops the Authorization header, so the key is sent in
  the address instead…"*. That is information, not an error — the push works.
- **The key is then visible to the shop's own access logs** (and anything in front of it: Cloudflare,
  a load balancer). That is the reason this is a fallback and not the default. The proper fix is on
  the shop's server, and it is one line — either of:

  ```nginx
  # nginx + php-fpm: ensure the header reaches PHP (some bundled fastcgi_params omit it)
  fastcgi_param HTTP_AUTHORIZATION $http_authorization;
  ```

  ```apache
  # Apache + PHP-CGI/FastCGI, in the site's .htaccess
  RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
  # ...or, if mod_setenvif is available:
  SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
  ```

  After that, **Test** again and the note disappears: the header is used, and the key stops appearing
  in URLs. A security plugin (Wordfence, iThemes) that strips the header has the same effect and the
  same fix — allow the REST route there.

## The rules the push follows

| Rule | Where it lives |
| --- | --- |
| Stock = `SUM(inventory.quantity)` over the DC **and every store** (`ALL`) | `server/woocommerce/stock-snapshot.ts` |
| A negative total is sent as `0` with `stock_status = outofstock` | `shared/woocommerce.ts` |
| Backorders are off: an item sells to exactly 0, then the shop refuses the sale | `shared/woocommerce.ts` |
| `manage_stock` is **reported, never forced** unless the channel opts in | `website_channels.force_manage_stock` |
| A product is sent when it is new, the ERP quantity changed, **or the site drifted** | `planStockSync` |
| The last accepted quantity is stored only after a confirmed success | `website_stock_state` |
| A second concurrent run of the same shop is refused (advisory lock) | `server/woocommerce/sync.ts` |

"Why does it re-send a product I already synced?" - because the shop reports a different quantity
than the ERP. That is a website sale or a manual edit in wp-admin, and the next run restores the
ERP number. It is also the reason a busy shop can oversell between two runs.

### `manage_stock`

WooCommerce ignores `stock_quantity` when *Track stock quantity for this product* is unchecked.
Those products are listed in the preview under **not tracking stock** and are never counted as
synced. Two ways out: tick the box in the shop, or switch on **Force stock tracking** on the
channel (the sync then sends `manage_stock: true` with the quantity).

## Modes

- **Changed only** (default) - the delta described above. This is the daily click.
- **All products** - rewrites every linked product. Use it after a broken run, a catalogue
  refresh that changed ids, or a shop that was edited by hand.

## What is recorded

| Table | Holds |
| --- | --- |
| `website_channels` | one shop: address, encrypted key, its rules |
| `website_product_links` | ERP product ↔ WooCommerce id, per shop (and whether it is parked) |
| `website_stock_sync_runs` | one row per click of **Sync now**, with the counts and status |
| `website_stock_sync_items` | one row per product sent, including the shop's own refusal |
| `website_stock_state` | the last quantity each shop accepted (the delta baseline) |

History is on the screen, newest first; click a row to see every line, including failures.

## Command line (first push, or without the browser)

```bash
npm run website:sync                          # test + preview every channel (writes nothing)
npm run website:sync -- --refresh             # also rebuild the SKU links
npm run website:sync -- --channel=2           # one shop
npm run website:sync -- --mode=all            # repair preview
npm run website:sync -- --run                 # actually push
```

Without `--run`, the only traffic is reads. `--run` prints `WRITING TO THE SHOPS` and the target
before it sends anything.

## Permissions

Module `websiteSync` - deliberately separate from `inventory`, because a run changes what
customers can buy. *View* opens the screen and the preview, *Edit* runs a sync and changes the
channel, *Create* adds a website, *Delete* removes it with its history. On an existing database,
`migrations/0037_website_stock_sync.sql` backfills read-only access for roles that already have
`inventory`, and full access for admin roles.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `refused the API key (401/403), in both the Authorization header and the query string` | The key really is refused: it belongs to another shop, was created Read-only, or its user has no `manage_woocommerce`. Re-enter both halves on the channel. If only the header attempt failed, the ERP retries in the query string by itself — see [a server that drops the Authorization header](#a-server-that-drops-the-authorization-header). |
| `has no WooCommerce REST API: both /wp-json/wc/v3 and ?rest_route=/wc/v3 returned 404` | WooCommerce deactivated, a security plugin blocking the REST API, or the address is not the WordPress site. Not a permalinks problem - that is handled. |
| `Could not reach …` | DNS/TLS/firewall, or the shop is in maintenance mode. |
| Products under **not tracking stock** | `manage_stock` unchecked in the shop (see above). |
| Unmapped SKUs after a refresh | SKU differs between the ERP and the shop, or the product is a *grouped*/*external* type (it has no stock of its own). |
| A run says **partial** | Some lines were refused - open the run to read the shop's own message per SKU. Failed lines keep their old state, so the next run retries them. |
| `The API key … could not be decrypted` | `INTEGRATION_SECRET_KEY` changed. Re-enter the key and secret on the channel. |
