const EMAIL_CATEGORIES = ["proposals", "offers", "submissions", "revisions"];
const emailPreferences = user => Object.fromEntries(EMAIL_CATEGORIES.map(key => [key, user?.emailPreferences?.[key] === true]));
module.exports = { EMAIL_CATEGORIES, emailPreferences };
