const dotenv = require("dotenv");
dotenv.config();

const connectDB = require("./db");
const app = require("./app");

async function start() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }
  await connectDB();
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`Server running on port ${port}`));
}

start().catch(error => {
  console.error("Startup failed:", error.message);
  process.exitCode = 1;
});
