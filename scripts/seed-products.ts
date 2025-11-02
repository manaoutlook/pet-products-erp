import { db } from "../db/index.js";
import { products } from "../db/schema.js";

async function seedProducts() {
  console.log("🌱 Seeding 20 product records...");

  try {
    // Product data with relationships to categories and brands
    const productsData = [
      // Dog Food (Category 1) - Royal Canin (Brand 1)
      { name: "Royal Canin Medium Adult", description: "Complete feed for medium breed adult dogs", sku: "RC-MA-001", price: "1250000.00", categoryId: 1, brandId: 1, minStock: 5 },
      { name: "Royal Canin Labrador Retriever", description: "Breed specific nutrition for Labrador Retrievers", sku: "RC-LAB-002", price: "1350000.00", categoryId: 1, brandId: 1, minStock: 3 },
      { name: "Royal Canin German Shepherd", description: "Specialized nutrition for German Shepherds", sku: "RC-GS-003", price: "1450000.00", categoryId: 1, brandId: 1, minStock: 4 },
      { name: "Royal Canin Bulldog", description: "Complete nutrition for Bulldogs", sku: "RC-BULL-004", price: "1300000.00", categoryId: 1, brandId: 1, minStock: 5 },

      // Dog Food (Category 1) - Purina (Brand 2)
      { name: "Purina Pro Plan Adult Chicken", description: "High protein dog food with real chicken", sku: "PP-AC-005", price: "950000.00", categoryId: 1, brandId: 2, minStock: 8 },
      { name: "Purina Pro Plan Puppy", description: "Complete nutrition for puppies", sku: "PP-PUP-006", price: "1050000.00", categoryId: 1, brandId: 2, minStock: 6 },
      { name: "Purina One SmartBlend", description: "Advanced nutrition for adult dogs", sku: "PO-SB-007", price: "850000.00", categoryId: 1, brandId: 2, minStock: 10 },

      // Cat Food (Category 2) - Whiskas (Brand 5)
      { name: "Whiskas Adult Tuna", description: "Delicious tuna flavor cat food", sku: "WK-AT-008", price: "650000.00", categoryId: 2, brandId: 5, minStock: 12 },
      { name: "Whiskas Kitten", description: "Complete nutrition for growing kittens", sku: "WK-KIT-009", price: "700000.00", categoryId: 2, brandId: 5, minStock: 8 },
      { name: "Whiskas Hairball Control", description: "Helps reduce hairballs in adult cats", sku: "WK-HC-010", price: "680000.00", categoryId: 2, brandId: 5, minStock: 10 },

      // Cat Food (Category 2) - Hill's Science Diet (Brand 3)
      { name: "Hill's Science Diet Adult", description: "Clinically proven nutrition for adult cats", sku: "HS-AC-011", price: "1200000.00", categoryId: 2, brandId: 3, minStock: 6 },
      { name: "Hill's Science Diet Kitten", description: "Precise nutrition for kittens", sku: "HS-KIT-012", price: "1250000.00", categoryId: 2, brandId: 3, minStock: 5 },

      // Pet Toys (Category 3) - No brand specified
      { name: "Rubber Chew Toy", description: "Durable rubber toy for dogs", sku: "PT-RCT-013", price: "150000.00", categoryId: 3, minStock: 20 },
      { name: "Interactive Puzzle Toy", description: "Mental stimulation toy for pets", sku: "PT-IPT-014", price: "250000.00", categoryId: 3, minStock: 15 },
      { name: "Cat Wand Toy", description: "Feather wand for interactive play", sku: "PT-CWT-015", price: "120000.00", categoryId: 3, minStock: 25 },
      { name: "Squeaky Ball Set", description: "Set of colorful squeaky balls", sku: "PT-SBS-016", price: "180000.00", categoryId: 3, minStock: 30 },

      // Pet Accessories (Category 4) - No brand specified
      { name: "Adjustable Dog Collar", description: "Durable nylon collar with quick release", sku: "PA-ADC-017", price: "200000.00", categoryId: 4, minStock: 15 },
      { name: "Leather Dog Leash", description: "6ft leather leash for medium to large dogs", sku: "PA-LDL-018", price: "350000.00", categoryId: 4, minStock: 12 },
      { name: "Cat Scratching Post", description: "Tall sisal scratching post for cats", sku: "PA-CSP-019", price: "450000.00", categoryId: 4, minStock: 8 },

      // Pet Health (Category 5) - Pedigree (Brand 4)
      { name: "Pedigree Dental Chews", description: "Dental health chews for dogs", sku: "PH-DC-020", price: "280000.00", categoryId: 5, brandId: 4, minStock: 18 }
    ];

    console.log("📦 Inserting products...");
    for (const product of productsData) {
      await db.insert(products).values(product);
      console.log(`✓ Inserted product: ${product.name} (${product.sku})`);
    }

    console.log("✅ Product seeding completed successfully!");
    console.log("\n📊 Summary:");
    console.log("- 20 Products inserted");
    console.log("- Relationships established:");
    console.log("  • All products linked to categories (required)");
    console.log("  • 11 products linked to brands (optional)");
    console.log("  • 9 products without brand association");
    console.log("  • Note: Suppliers are NOT directly related to products");
    console.log("    (suppliers relate to inventory and purchase orders, not products directly)");

  } catch (error) {
    console.error("❌ Error seeding products:", error);
    process.exit(1);
  }

  process.exit(0);
}

seedProducts();
