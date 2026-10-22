const Notification = require("./models/Notification");
const User = require("./models/User");
const { sendEventEmail, resetDeliveryMode } = require("./resetMail");

// MongoDB holds the queue; a lease allows recovery after a server restart.
async function processEventEmails({ send = sendEventEmail, batchSize = 10 } = {}) {
  if (process.env.EVENT_EMAILS_ENABLED !== "true" || resetDeliveryMode() === "unavailable") return 0;
  let processed = 0;
  for (; processed < batchSize; processed++) {
    const now = new Date();
    const notification = await Notification.findOneAndUpdate({
      $or: [{ emailStatus: "pending", emailNextAttemptAt: { $lte: now } }, { emailStatus: "sending", emailLeaseUntil: { $lt: now } }],
    }, { $set: { emailStatus: "sending", emailLeaseUntil: new Date(now.getTime() + 120000) }, $inc: { emailAttempts: 1 } }, { sort: { createdAt: 1 }, returnDocument: "after" });
    if (!notification) break;
    // The lease value also prevents a slow, expired worker overwriting a newer attempt.
    const claim = { _id: notification._id, emailStatus: "sending", emailLeaseUntil: notification.emailLeaseUntil, emailAttempts: notification.emailAttempts };
    if (notification.emailAttempts > 3) {
      await Notification.updateOne(claim, { $set: { emailStatus: "failed" }, $unset: { emailLeaseUntil: 1 } });
      continue;
    }
    try {
      const user = await User.findById(notification.user).select("email emailPreferences").lean();
      if (!user?.email || user.emailPreferences?.[notification.emailCategory] !== true || process.env.EVENT_EMAILS_ENABLED !== "true") {
        await Notification.updateOne(claim, { $set: { emailStatus: "skipped" }, $unset: { emailLeaseUntil: 1 } });
        continue;
      }
      const mode = await send(user.email, notification);
      await Notification.updateOne(claim, { $set: { emailStatus: "sent", emailSentAt: new Date(), emailDeliveryMode: mode }, $unset: { emailLeaseUntil: 1 } });
    } catch {
      const failed = notification.emailAttempts >= 3;
      await Notification.updateOne(claim, { $set: { emailStatus: failed ? "failed" : "pending", emailNextAttemptAt: new Date(Date.now() + notification.emailAttempts * 60000) }, $unset: { emailLeaseUntil: 1 } });
      console.error(`Event email ${notification._id}: ${failed ? "failed after 3 attempts" : "retry scheduled"}`);
    }
  }
  return processed;
}

function startEventEmailWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processEventEmails(); }
    catch { console.error("Event email queue unavailable; will retry."); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 15000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
module.exports = { processEventEmails, startEventEmailWorker };
