import "dotenv/config";
import {
  listChannels,
  requireChannel,
  resolveChannelCredentials,
} from "../server/woocommerce/channels";
import { refreshChannelCatalogue } from "../server/woocommerce/catalogue";
import { WooCommerceClient } from "../server/woocommerce/client";
import { previewStockSync, runStockSync } from "../server/woocommerce/sync";
import type { StockSyncMode } from "../shared/woocommerce";

/**
 * Command-line dry run for the website stock sync.
 *
 *   npx tsx scripts/woocommerce-sync.ts                  # test + preview every channel
 *   npx tsx scripts/woocommerce-sync.ts --refresh        # also rebuild the SKU links
 *   npx tsx scripts/woocommerce-sync.ts --channel=2      # only one shop
 *   npx tsx scripts/woocommerce-sync.ts --mode=all       # repair preview
 *   npx tsx scripts/woocommerce-sync.ts --run            # actually push
 *
 * It exists so the first push to a live shop can be inspected on a terminal instead of trusted
 * from a browser: the same plan the screen shows, printed in full. Without `--run` nothing is sent
 * to the shop (the optional catalogue refresh still reads it).
 *
 * AI Agent Note - `--run` is opt-in and echoed before it happens:
 * A dry run that also writes is not a dry run. The flag is explicit, and the mode and target are
 * printed first so a wrong `--channel` is caught by reading the output, not by a live-site mistake.
 *
 * AI Agent Note - `process.exit` at the end:
 * The database pool keeps handles open, so the script would otherwise hang after printing.
 */

const args = process.argv.slice(2);

function flagValue(name: string): string | null {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const channelFilter = flagValue("channel");
const mode: StockSyncMode = flagValue("mode") === "all" ? "all" : "changed";
const shouldRefresh = args.includes("--refresh");
const shouldRun = args.includes("--run");

function showQuantity(value: number | null): string {
  return value === null ? "—" : String(value);
}

async function main() {
  const channels = await listChannels();
  const targets = channelFilter ? channels.filter((c) => String(c.id) === channelFilter) : channels;

  if (targets.length === 0) {
    console.log(
      channelFilter
        ? `No website with id ${channelFilter}. Known ids: ${channels.map((c) => c.id).join(", ") || "none"}`
        : "No website is set up yet - add one on the Website Stock Sync screen.",
    );
    process.exit(1);
  }

  console.log(
    `Mode: ${mode === "all" ? "ALL products (repair)" : "changed only"} | ` +
      `${shouldRun ? "WRITING TO THE SHOPS" : "dry run, nothing will be written"}\n`,
  );

  let failures = 0;

  for (const channel of targets) {
    console.log("=".repeat(78));
    console.log(`#${channel.id} ${channel.name} - ${channel.baseUrl}`);
    console.log(
      `active: ${channel.isActive} | scope: ${channel.stockScope} | key: ${channel.consumerKeyMasked}`,
    );
    console.log("=".repeat(78));

    if (!channel.isActive) {
      console.log("Skipped: the channel is switched off.\n");
      continue;
    }

    try {
      // The row is re-read because the public shape deliberately has no ciphertext.
      const row = await requireChannel(channel.id);
      const client = new WooCommerceClient({
        baseUrl: row.baseUrl,
        ...resolveChannelCredentials(row),
      });

      const connection = await client.testConnection();
      console.log(
        `Connection OK - ${connection.totalProducts ?? "?"} products on the shop (sampled ${connection.sampleProducts}).`,
      );
    } catch (error) {
      failures += 1;
      console.error(`Connection FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
      continue;
    }

    if (shouldRefresh) {
      try {
        const result = await refreshChannelCatalogue(channel.id);
        console.log(
          `Catalogue refreshed: ${result.linked}/${result.siteEntries} matched ` +
            `(${result.created} new, ${result.dropped} dropped, ${result.unmapped.length} unmapped).`,
        );
        for (const entry of result.unmapped.slice(0, 20)) {
          console.log(`  unmapped [${entry.reason}] ${entry.sku || "(no sku)"} - ${entry.name}`);
        }
        if (result.unmapped.length > 20) {
          console.log(`  … ${result.unmapped.length - 20} more unmapped`);
        }
      } catch (error) {
        failures += 1;
        console.error(
          `Catalogue refresh FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        continue;
      }
    }

    try {
      const preview = await previewStockSync(channel.id, mode);
      const { totals } = preview;

      console.log(
        `\nPreview: ${totals.toSend} to send | ${totals.unchanged} already matching | ` +
          `${totals.notTracking} not tracking stock | ${totals.linkedProducts} linked / ` +
          `${totals.snapshotProducts} products`,
      );

      for (const item of preview.items.slice(0, 25)) {
        console.log(
          `  ${item.sku.padEnd(24)} site ${showQuantity(item.siteQuantity).padStart(6)} ` +
            `-> ${showQuantity(item.quantity).padStart(6)}  ${item.stockStatus.padEnd(11)} [${item.reason}]`,
        );
      }
      if (preview.items.length > 25) console.log(`  … ${preview.items.length - 25} more`);

      if (preview.notTracking.length > 0) {
        console.log(
          `\n  Not tracking stock on this shop: ${preview.notTracking
            .slice(0, 10)
            .map((item) => item.sku)
            .join(", ")}${preview.notTracking.length > 10 ? " …" : ""}`,
        );
      }

      if (shouldRun) {
        const result = await runStockSync({ channelId: channel.id, mode });
        console.log(`\nRun #${result.runId}: ${result.status.toUpperCase()} - ${result.message}`);
        for (const failure of result.failures) {
          console.log(`  FAILED ${failure.sku}: ${failure.message}`);
        }
        if (result.status === "failed") failures += 1;
      } else {
        console.log("\nNothing written. Re-run with --run to push these numbers.");
      }

      console.log("");
    } catch (error) {
      failures += 1;
      console.error(`Sync FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
