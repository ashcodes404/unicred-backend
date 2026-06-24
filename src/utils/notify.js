// utils/notify.js

const prisma = require("../config/db");

/**
 * Create notification for a single user
 */
async function notify(userId, type, message, link = null) {
  console.log("NOTIFY CALLED");
   console.log({
    userId,
    type,
    message,
    link,
  });
  return prisma.notification.create({
    data: {
      userId,
      type,
      message,
      link,
    },
  });
}

/**
 * Create notifications for many users at once
 */
async function notifyMany(userIds, type, message, link = null) {
  if (!userIds?.length) return;

  return prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type,
      message,
      link,
    })),
  });
}

module.exports = {
  notify,
  notifyMany,
};