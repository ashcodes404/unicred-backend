// prisma/seed-subscription-plans.js
// Run manually with: node prisma/seed-subscription-plans.js
// Seeds the 4 default subscription plans schools can pick during registration.
const prisma = require("../src/config/db");

async function main() {
  const plans = [
    { name: "6 Months", durationMonths: 6, price: 4999 },
    { name: "1 Year", durationMonths: 12, price: 8999 },
    { name: "2 Years", durationMonths: 24, price: 16999 },
    { name: "3 Years", durationMonths: 36, price: 22999 },
  ];

  // `name` has no unique constraint on SubscriptionPlan, so createMany's
  // skipDuplicates wouldn't actually detect duplicates here. Check by name
  // first so re-running this script is safe and doesn't create doubles.
  for (const plan of plans) {
    const existing = await prisma.subscriptionPlan.findFirst({ where: { name: plan.name } });
    if (!existing) {
      await prisma.subscriptionPlan.create({ data: plan });
    }
  }

  console.log("✅ Subscription plans seeded");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
