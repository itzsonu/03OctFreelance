// Private owner-operated Apps Script. Never publish as a web app or log tokens.
const BACKUP_API = "https://freelancechain-api-zje1.onrender.com";
const BACKUP_FOLDER_NAME = "FreelanceChain_Private_Automatic_Backups";
function identity_() {
  const token = ScriptApp.getIdentityToken();
  if (!token) throw new Error("Authorize the explicit openid/email scopes first.");
  const body = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(token.split(".")[1])).getDataAsString());
  if (body.email_verified !== true || !body.email || !body.aud) throw new Error("Verified owner identity is unavailable.");
  return { token: token, email: body.email.toLowerCase(), audience: body.aud };
}
function ownerOnly_(id, owner) {
  const file = Drive.Files.get(id, { fields: "id,name,mimeType,shared,permissions(type,role,emailAddress),trashed,parents,size,appProperties" });
  if (file.trashed || file.shared || !file.permissions || file.permissions.length !== 1 ||
    file.permissions[0].role !== "owner" || file.permissions[0].emailAddress.toLowerCase() !== owner) {
    throw new Error("Backup destination is not owner-only. No data will be uploaded.");
  }
  return file;
}
function setupBackup() {
  const identity = identity_(), properties = PropertiesService.getScriptProperties();
  if (properties.getProperty("OWNER_EMAIL") && properties.getProperty("OWNER_EMAIL") !== identity.email) throw new Error("Owner changed; review configuration.");
  let folderId = properties.getProperty("FOLDER_ID");
  if (!folderId) {
    const folder = Drive.Files.create({ name: BACKUP_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }, null, { fields: "id" });
    folderId = folder.id;
    properties.setProperty("FOLDER_ID", folderId);
  }
  const folder = ownerOnly_(folderId, identity.email);
  if (folder.mimeType !== "application/vnd.google-apps.folder") throw new Error("Invalid backup folder.");
  properties.setProperties({ OWNER_EMAIL: identity.email, SCRIPT_CLIENT_ID: identity.audience });
  // These values are identifiers, not authentication tokens or private keys.
  const result = { CLOUD_BACKUP_SCRIPT_CLIENT_ID: identity.audience, CLOUD_BACKUP_OWNER_EMAIL: identity.email,
    folderUrl: "https://drive.google.com/drive/folders/" + folderId,
    next: "Configure those public identity fields and CLOUD_BACKUP_PUBLIC_KEY on Render. Set EXPECTED_KEY_FINGERPRINT in this project's script properties from the local public-config.json. Then run installWeeklyBackup." };
  console.log(JSON.stringify(result)); return result;
}
function digest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (n) { return ("0" + ((n + 256) % 256).toString(16)).slice(-2); }).join("");
}
function request_(url, identity, method) {
  // Never forward tokens across redirects or to user-controlled destinations.
  if (url.indexOf(BACKUP_API + "/api/") !== 0) throw new Error("Unexpected backup destination.");
  return UrlFetchApp.fetch(url, { method: method, headers: { Authorization: "Bearer " + identity.token },
    muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true });
}
function downloadedHash_(id) {
  const response = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?alt=media", {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
    followRedirects: false, validateHttpsCertificates: true });
  if (response.getResponseCode() !== 200) throw new Error("Encrypted Drive download verification failed.");
  return digest_(response.getContentText());
}
function runWeeklyBackup() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error("Another backup is active.");
  try {
    const properties = PropertiesService.getScriptProperties(), identity = identity_();
    const folderId = properties.getProperty("FOLDER_ID"), expectedKey = properties.getProperty("EXPECTED_KEY_FINGERPRINT");
    if (!folderId || !/^[a-f0-9]{64}$/.test(expectedKey || "") || identity.email !== properties.getProperty("OWNER_EMAIL") ||
      identity.audience !== properties.getProperty("SCRIPT_CLIENT_ID")) throw new Error("Complete and review the backup configuration first.");
    ownerOnly_(folderId, identity.email);
    const day = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
    const found = Drive.Files.list({ q: "'" + folderId + "' in parents and trashed = false and appProperties has { key='fcBackupDate' and value='" + day + "' }",
      pageSize: 10, fields: "files(id,name,appProperties),nextPageToken" });
    if (found.nextPageToken || found.files.length > 1) throw new Error("Multiple daily copies require owner review; no files deleted.");
    if (found.files.length === 1) {
      const existing = ownerOnly_(found.files[0].id, identity.email);
      if (existing.appProperties.fcBackupKey !== expectedKey || downloadedHash_(existing.id) !== existing.appProperties.fcBackupSha256) throw new Error("Existing cloud copy failed verification.");
      console.log(JSON.stringify({ alreadyVerifiedToday: true, fileId: existing.id })); return existing.id;
    }
    // Free Render can wake slowly. Only public health checks are retried here.
    let ready = false;
    for (let i = 0; i < 3; i++) {
      try {
        const response = UrlFetchApp.fetch(BACKUP_API + "/api/health/ready", { muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true });
        if (response.getResponseCode() === 200 && JSON.parse(response.getContentText()).status === "ready") { ready = true; break; }
      } catch (_) {}
      Utilities.sleep(5000);
    }
    if (!ready) throw new Error("Backend did not become ready; no backup claimed.");
    const statusResponse = request_(BACKUP_API + "/api/backup-cloud/v1/status", identity, "get");
    if (statusResponse.getResponseCode() !== 200) throw new Error("Backup identity/configuration check failed: HTTP " + statusResponse.getResponseCode());
    if (JSON.parse(statusResponse.getContentText()).keyFingerprint !== expectedKey) throw new Error("Recipient key fingerprint mismatch.");
    const response = request_(BACKUP_API + "/api/backup-cloud/v1/export", identity, "post");
    if (response.getResponseCode() !== 200) throw new Error("Snapshot export failed: HTTP " + response.getResponseCode());
    const bundle = JSON.parse(response.getContentText());
    if (bundle.format !== "JWE-zip-v1" || bundle.keyFingerprint !== expectedKey || typeof bundle.ciphertext !== "string" ||
      bundle.ciphertext.length > 24 * 1024 * 1024 || bundle.ciphertext.split(".").length !== 5 ||
      bundle.bytes !== Utilities.newBlob(bundle.ciphertext).getBytes().length || digest_(bundle.ciphertext) !== bundle.sha256 ||
      !/^FreelanceChain-auto-[0-9TZ.-]+\.zip\.jwe$/.test(bundle.fileName)) throw new Error("Encrypted export integrity check failed.");
    const blob = Utilities.newBlob(bundle.ciphertext, "application/jose", bundle.fileName);
    const file = Drive.Files.create({ name: bundle.fileName, parents: [folderId], mimeType: "application/jose",
      appProperties: { fcBackupDate: day, fcBackupSha256: bundle.sha256, fcBackupKey: expectedKey, fcBackupFormat: "JWE-zip-v1" } },
      blob, { fields: "id" });
    const stored = ownerOnly_(file.id, identity.email);
    if (Number(stored.size) !== bundle.bytes || stored.parents.indexOf(folderId) < 0 || downloadedHash_(file.id) !== bundle.sha256) {
      throw new Error("Cloud copy did not pass download verification. Keep it for investigation; no success recorded.");
    }
    const receipt = { verifiedAt: new Date().toISOString(), fileId: file.id, folderId: folderId, bytes: bundle.bytes,
      sha256: bundle.sha256, keyFingerprint: expectedKey, snapshot: bundle.summary, downloadHashVerified: true };
    properties.setProperty("LAST_VERIFIED_BACKUP", JSON.stringify(receipt));
    console.log(JSON.stringify(receipt)); return file.id;
  } finally { lock.releaseLock(); }
}
function installWeeklyBackup() {
  // A first real export/upload/download must pass before a recurring trigger is installed.
  const fileId = runWeeklyBackup();
  const existing = ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === "runWeeklyBackup"; });
  if (existing.length > 1) throw new Error("Duplicate triggers require owner review.");
  if (!existing.length) ScriptApp.newTrigger("runWeeklyBackup").timeBased().inTimezone("Asia/Kolkata")
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).everyWeeks(1).create();
  const result = { active: true, schedule: "Sunday, approximately 03:00-04:00 Asia/Kolkata", firstVerifiedFileId: fileId,
    retainedCopies: "All generations; automatic deletion is disabled." };
  console.log(JSON.stringify(result)); return result;
}
