const User = require("./models/User");
async function hiringAvailable(project, freelancer) {
  if (project.moderationHidden) return false;
  const ids = [project.client?._id || project.client, freelancer?._id || freelancer].filter(Boolean);
  return !await User.exists({ _id: { $in: ids }, suspended: true });
}
function ownerLookup() {
  return { $lookup: { from: "users", let: { owner: "$client" }, pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$owner"] }, suspended: { $ne: true } } }, { $project: { _id: 1 } }], as: "availableOwner" } };
}
function publicStages(filter = {}) {
  return [{ $match: { ...filter, status: "Open", moderationHidden: { $ne: true } } }, ownerLookup(), { $match: { "availableOwner.0": { $exists: true } } }, { $unset: "availableOwner" }];
}
module.exports = { hiringAvailable, ownerLookup, publicStages };
