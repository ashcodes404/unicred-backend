// test-prisma.js

require("dotenv").config();

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.school.findMany();

    console.log("SUCCESS");
    console.log(result);
  } catch (err) {
    console.error("ERROR:");
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();