import { prisma } from "../src/lib/prisma";
import bcrypt from "bcrypt";

async function main() {
  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: "admin@chatbot.com" },
    update: {},
    create: {
      email: "admin@chatbot.com",
      name: "Admin User",
      password: await bcrypt.hash("admin123", 10),
      role: "ADMIN",
    },
  });

  // Create default settings
  await prisma.adminSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      maxChatsPerUser: 5,
      autoCloseTimeout: 3600,
      enableNotifications: true,
      maintenanceMode: false,
      maxMessageLength: 5000,
      enableAutoResponse: true,
      autoResponseMessage: "Thank you for contacting us. An agent will be with you soon.",
    },
  });

  console.log("✅ Seed data created successfully");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });