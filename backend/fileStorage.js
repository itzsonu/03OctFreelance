const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const multer = require("multer");

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const TYPES = {
  ".pdf": { mime: "application/pdf", signature: buffer => buffer.subarray(0, 5).toString() === "%PDF-" },
  ".txt": { mime: "text/plain", text: true },
  ".csv": { mime: "text/csv", text: true },
  ".png": { mime: "image/png", signature: buffer => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  ".jpg": { mime: "image/jpeg", signature: buffer => buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 },
  ".jpeg": { mime: "image/jpeg", signature: buffer => buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 },
  ".webp": { mime: "image/webp", signature: buffer => buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP" },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 3, fields: 8, fieldSize: 6000 },
});

function parseFiles(req, res, next) {
  upload.array("files", 3)(req, res, error => {
    if (!error) return next();
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json({ message: tooLarge ? "Each file must be 10 MB or smaller" : "Invalid upload" });
  });
}

function validateFile(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const type = TYPES[extension];
  if (!type || file.mimetype !== type.mime || !file.buffer?.length || file.size > MAX_FILE_SIZE) return false;
  if (type.text) {
    const text = file.buffer.toString("utf8");
    return !text.includes("\u0000") && !text.includes("\ufffd");
  }
  return type.signature(file.buffer);
}

function storageRoot() {
  const root = path.resolve(process.env.PRIVATE_UPLOAD_DIR || path.join(__dirname, ".private-uploads"));
  const publicRoots = [path.resolve(__dirname, "../public"), path.resolve(__dirname, "../build")];
  if (publicRoots.some(publicRoot => {
    const relative = path.relative(publicRoot, root);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
  })) throw new Error("Private uploads cannot be stored under a frontend-served directory");
  return root;
}

async function storeFile(file) {
  if (!validateFile(file)) {
    const error = new Error("Unsupported or invalid file content");
    error.code = "INVALID_FILE";
    throw error;
  }
  const id = crypto.randomUUID();
  await fs.mkdir(storageRoot(), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(storageRoot(), id), file.buffer, { flag: "wx", mode: 0o600 });
  const extension = path.extname(file.originalname).toLowerCase();
  return {
    storageKey: id,
    filename: path.basename(file.originalname).replace(/[\r\n\u0000-\u001f\u007f]/g, "_").slice(0, 180) || `attachment${extension}`,
    mimeType: TYPES[extension].mime,
    size: file.size,
  };
}

async function readFile(storageKey) {
  if (typeof storageKey !== "string" || !/^[0-9a-f-]{36}$/.test(storageKey)) return null;
  try { return await fs.readFile(path.join(storageRoot(), storageKey)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function removeFile(storageKey) {
  if (typeof storageKey !== "string" || !/^[0-9a-f-]{36}$/.test(storageKey)) return;
  try { await fs.unlink(path.join(storageRoot(), storageKey)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

module.exports = { MAX_FILE_SIZE, upload, parseFiles, validateFile, storeFile, readFile, removeFile };