import "dotenv/config";
import { db } from "../db/index.js";
import { customerProfiles } from "../db/schema.js";

async function seedCustomerProfiles() {
  console.log("🐾 Creating Customer Profiles...");

  try {
    const customerProfilesData = [
      {
        phoneNumber: "+84-912-345-678",
        name: "Nguyen Thi Mai",
        email: "mai.nguyen@email.com",
        address: "123 Nguyen Trai, District 1, Ho Chi Minh City",
        petBirthday: "2022-03-15",
        petType: "CAT"
      },
      {
        phoneNumber: "+84-913-456-789",
        name: "Tran Van Minh",
        email: "minh.tran@email.com",
        address: "456 Le Loi, District 3, Ho Chi Minh City",
        petBirthday: "2021-08-22",
        petType: "DOG"
      },
      {
        phoneNumber: "+84-914-567-890",
        name: "Le Thi Lan",
        email: "lan.le@email.com",
        address: "789 Tran Hung Dao, District 5, Ho Chi Minh City",
        petBirthday: "2023-01-10",
        petType: "CAT"
      },
      {
        phoneNumber: "+84-915-678-901",
        name: "Pham Van Tuan",
        email: "tuan.pham@email.com",
        address: "321 Vo Van Kiet, District 1, Ho Chi Minh City",
        petBirthday: "2020-11-05",
        petType: "DOG"
      },
      {
        phoneNumber: "+84-916-789-012",
        name: "Hoang Thi Linh",
        email: "linh.hoang@email.com",
        address: "654 Pham Ngu Lao, District 1, Ho Chi Minh City",
        petBirthday: "2022-06-30",
        petType: "CAT"
      },
      {
        phoneNumber: "+84-917-890-123",
        name: "Vo Van Duc",
        email: "duc.vo@email.com",
        address: "987 Ben Thanh Market, District 1, Ho Chi Minh City",
        petBirthday: "2021-12-18",
        petType: "DOG"
      },
      {
        phoneNumber: "+84-918-901-234",
        name: "Dinh Thi Hoa",
        email: "hoa.dinh@email.com",
        address: "147 Dong Khoi, District 1, Ho Chi Minh City",
        petBirthday: "2023-04-25",
        petType: "CAT"
      },
      {
        phoneNumber: "+84-919-012-345",
        name: "Bui Van Hien",
        email: "hien.bui@email.com",
        address: "258 Pasteur, District 3, Ho Chi Minh City",
        petBirthday: "2020-09-12",
        petType: "DOG"
      },
      {
        phoneNumber: "+84-920-123-456",
        name: "Do Thi Mai",
        email: "mai.do@email.com",
        address: "369 Nguyen Thien Thuat, District 3, Ho Chi Minh City",
        petBirthday: "2022-07-08",
        petType: "CAT"
      },
      {
        phoneNumber: "+84-921-234-567",
        name: "Nguyen Van An",
        email: "an.nguyen@email.com",
        address: "741 Cach Mang Thang Tam, District 3, Ho Chi Minh City",
        petBirthday: "2021-05-20",
        petType: "DOG"
      },
      {
        phoneNumber: "+84-922-345-678",
        name: "Tran Thi Huong",
        email: "huong.tran@email.com",
        address: "852 Le Hong Phong, District 5, Ho Chi Minh City",
        petBirthday: "2023-02-14",
        petType: "CAT"
      },
      {
        phoneNumber: "+84-923-456-789",
        name: "Le Van Tuan",
        email: "tuan.le@email.com",
        address: "963 Tran Phu, District 5, Ho Chi Minh City",
        petBirthday: "2020-10-30",
        petType: "DOG"
      },
      {
        phoneNumber: "+84-924-567-890",
        name: "Pham Thi Linh",
        email: "linh.pham@email.com",
        address: "159 Nguyen Van Cu, District 5, Ho Chi Minh City",
        petBirthday: "2022-09-05",
        petType: "CAT"
      },
      {
        phoneNumber: "+84-925-678-901",
        name: "Hoang Van Minh",
        email: "minh.hoang@email.com",
        address: "357 Ham Nghi, District 1, Ho Chi Minh City",
        petBirthday: "2021-04-17",
        petType: "DOG"
      },
      {
        phoneNumber: "+84-926-789-012",
        name: "Vo Thi Lan",
        email: "lan.vo@email.com",
        address: "468 Le Lai, District 1, Ho Chi Minh City",
        petBirthday: "2023-03-28",
        petType: "CAT"
      },
      {
        phoneNumber: "+84-927-890-123",
        name: "Dinh Van Duc",
        email: "duc.dinh@email.com",
        address: "579 Hai Ba Trung, District 3, Ho Chi Minh City",
        petBirthday: "2020-12-03",
        petType: "DOG"
      },
      {
        phoneNumber: "+84-928-901-234",
        name: "Bui Thi Hoa",
        email: "hoa.bui@email.com",
        address: "681 Ly Tu Trong, District 1, Ho Chi Minh City",
        petBirthday: "2022-08-19",
        petType: "CAT"
      },
      {
        phoneNumber: "+84-929-012-345",
        name: "Do Van Hien",
        email: "hien.do@email.com",
        address: "792 Nguyen Du, District 1, Ho Chi Minh City",
        petBirthday: "2021-06-11",
        petType: "DOG"
      },
      {
        phoneNumber: "+84-930-123-456",
        name: "Nguyen Thi An",
        email: "an.nguyen2@email.com",
        address: "804 Cong Quynh, District 1, Ho Chi Minh City",
        petBirthday: "2023-05-07",
        petType: "CAT"
      },
      {
        phoneNumber: "+84-931-234-567",
        name: "Tran Van Tuan",
        email: "tuan.tran@email.com",
        address: "915 Ton Duc Thang, District 1, Ho Chi Minh City",
        petBirthday: "2020-07-24",
        petType: "DOG"
      }
    ];

    const createdProfiles = [];
    for (const profile of customerProfilesData) {
      const result = await db.insert(customerProfiles).values(profile).returning();
      createdProfiles.push(result[0]);
      console.log(`✓ Created customer profile: ${profile.name} (${profile.petType})`);
    }

    console.log("\n✅ Customer profiles creation completed!");
    console.log(`- ${createdProfiles.length} customer profiles created`);

    console.log("\n📊 Customer Profile Summary:");
    const catProfiles = createdProfiles.filter(p => p.petType === 'CAT').length;
    const dogProfiles = createdProfiles.filter(p => p.petType === 'DOG').length;
    console.log(`  • Cat owners: ${catProfiles}`);
    console.log(`  • Dog owners: ${dogProfiles}`);

  } catch (error) {
    console.error("❌ Error creating customer profiles:", error);
    process.exit(1);
  }

  process.exit(0);
}

seedCustomerProfiles();
