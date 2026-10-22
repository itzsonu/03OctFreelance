const emailChangeFields = { pendingEmail: "", emailChangeTokenHash: "", emailChangeExpiresAt: "", emailChangeRequestedAt: "" };
const resetFields = { passwordResetTokenHash: "", passwordResetExpiresAt: "", passwordResetRequestedAt: "" };
function passwordError(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) return "Password must have 8–128 characters";
  if (Buffer.byteLength(value, "utf8") > 72) return "Password is too long. Please use a shorter password.";
  return "";
}
module.exports = { emailChangeFields, resetFields, passwordError };
