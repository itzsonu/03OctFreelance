const Notification = require("./models/Notification");
const { publishUser } = require("./liveUpdates");
const User = require("./models/User");
const { EMAIL_CATEGORIES } = require("./emailPreferences");

async function notifyUser(user, type, title, body, link, emailCategory) {
  if (!user) return null;
  try {
    const notification = await Notification.create({ user, type, title, body, link });
    publishUser(user, "notifications");
    // Delivery is separate from the workflow: email failures never undo a proposal or submission.
    if (EMAIL_CATEGORIES.includes(emailCategory)) {
      try {
        const recipient = await User.findById(user._id || user).select("emailPreferences").lean();
        notification.emailCategory = emailCategory;
        notification.emailStatus = process.env.EVENT_EMAILS_ENABLED === "true" && recipient?.emailPreferences?.[emailCategory] === true ? "pending" : "skipped";
        notification.emailNextAttemptAt = new Date();
        await notification.save();
      } catch (error) { console.error("Could not queue event email:", error.name); }
    }
    return notification;
  } catch (error) {
    console.error("Could not save notification:", error.message);
    return null;
  }
}

module.exports = { notifyUser };
