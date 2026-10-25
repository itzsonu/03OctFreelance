const readline = require("node:readline");
const { Writable } = require("node:stream");
function createPrompt(input, visibleOutput) {
  let muted = false;
  const terminalOutput = new Writable({ write(chunk, encoding, callback) { if (!muted) visibleOutput.write(chunk); callback(); } });
  const rl = readline.createInterface({ input, output: terminalOutput, terminal: true, historySize: 0 });
  function ask(label, secret = false) {
    return new Promise(resolve => {
      muted = secret;
      rl.question(label, answer => {
        muted = false;
        if (secret) visibleOutput.write("\n");
        setImmediate(() => resolve(answer));
      });
      if (secret) visibleOutput.write(label);
    });
  }
  async function confirmCreate() {
    while (true) {
      const value = (await ask("Type CREATE to create this admin, or CANCEL to stop: ")).trim().toUpperCase();
      if (value === "CREATE") return true;
      if (value === "CANCEL") return false;
      visibleOutput.write("No account created yet. Please enter CREATE or CANCEL.\n");
    }
  }
  return { ask, confirmCreate, close() { muted = false; rl.close(); } };
}
module.exports = { createPrompt };
