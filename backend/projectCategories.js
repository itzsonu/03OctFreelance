const JOB_CATEGORIES = ["Web Development", "Design & Creative", "Writing & Translation", "Marketing", "Data & Analytics", "Video & Animation", "Admin & Support", "Other"];

function validateProjectCategory({ category, customCategory } = {}) {
  // Older clients and stored projects did not supply category details.
  if (category === undefined) return { category: undefined, customCategory: "" };
  if (typeof category !== "string" || !JOB_CATEGORIES.includes(category)) throw new Error("Choose a valid project category");
  if (category !== "Other") return { category, customCategory: "" };
  const field = typeof customCategory === "string" ? customCategory.trim() : "";
  if (field.length < 2 || field.length > 80) throw new Error("For Other, describe the project field in 2–80 characters");
  return { category, customCategory: field };
}

module.exports = { JOB_CATEGORIES, validateProjectCategory };
