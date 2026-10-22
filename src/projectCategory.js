export const projectCategoryLabel = project => project.category === "Other" && project.customCategory
  ? `Other · ${project.customCategory}`
  : project.category || "Other";
