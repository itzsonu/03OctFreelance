const Notification = require("./models/Notification");
const { publishUser } = require("./liveUpdates");

async function notifyUser(user, type, title, body, link) {
  if (!user) return null;
  try {
    const notification = await Notification.create({ user, type, title, body, link });
    publishUser(user, "notifications");
    return notification;
  } catch (error) {
    console.error("Could not save notification:", error.message);
    return null;
  }
}

module.exports = { notifyUser };
