import "dotenv/config";
import { db } from "../db/index.js";
import { categories, brands, suppliers } from "../db/schema.js";

async function seedSampleData() {
  console.log("🌱 Seeding sample data...");

  try {
    // Insert 5 categories
    console.log("📂 Inserting categories...");
    const categoriesData = [
      { name: "Dog Food", description: "Premium dog food and treats" },
      { name: "Cat Food", description: "High-quality cat food and nutrition" },
      { name: "Pet Toys", description: "Fun toys for dogs and cats" },
      { name: "Pet Accessories", description: "Collars, leashes, and accessories" },
      { name: "Pet Health", description: "Vitamins, supplements, and healthcare products" }
    ];

    for (const category of categoriesData) {
      await db.insert(categories).values(category);
      console.log(`✓ Inserted category: ${category.name}`);
    }

    // Insert 5 brands
    console.log("🏷️  Inserting brands...");
    const brandsData = [
      { name: "Royal Canin", description: "Premium pet nutrition brand" },
      { name: "Purina", description: "Trusted pet food manufacturer" },
      { name: "Hill's Science Diet", description: "Veterinarian recommended nutrition" },
      { name: "Pedigree", description: "Affordable quality pet food" },
      { name: "Whiskas", description: "Cat food specialists" }
    ];

    for (const brand of brandsData) {
      await db.insert(brands).values(brand);
      console.log(`✓ Inserted brand: ${brand.name}`);
    }

    // Insert 5 suppliers
    console.log("🏢 Inserting suppliers...");
    const suppliersData = [
      {
        name: "Pet Supplies Plus",
        contactInfo: "contact@petsuppliesplus.com | (555) 123-4567",
        address: "123 Pet Street, Animal City, AC 12345"
      },
      {
        name: "Global Pet Distributors",
        contactInfo: "sales@globalpetdist.com | (555) 234-5678",
        address: "456 Supply Ave, Distribution Town, DT 23456"
      },
      {
        name: "Premium Pet Imports",
        contactInfo: "import@premiumpet.com | (555) 345-6789",
        address: "789 Import Blvd, Harbor City, HC 34567"
      },
      {
        name: "Local Pet Warehouse",
        contactInfo: "warehouse@localpet.com | (555) 456-7890",
        address: "321 Storage Lane, Warehouse District, WD 45678"
      },
      {
        name: "Pet Nutrition Corp",
        contactInfo: "nutrition@petnutrition.com | (555) 567-8901",
        address: "654 Nutrition Way, Health City, HC 56789"
      }
    ];

    for (const supplier of suppliersData) {
      await db.insert(suppliers).values(supplier);
      console.log(`✓ Inserted supplier: ${supplier.name}`);
    }

    console.log("✅ Sample data seeding completed successfully!");
    console.log("\n📊 Summary:");
    console.log("- 5 Categories inserted");
    console.log("- 5 Brands inserted");
    console.log("- 5 Suppliers inserted");

  } catch (error) {
    console.error("❌ Error seeding sample data:", error);
    process.exit(1);
  }

  process.exit(0);
}

seedSampleData();
