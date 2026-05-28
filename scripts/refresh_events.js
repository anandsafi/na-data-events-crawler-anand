const fs = require("fs");

async function refreshEvents() {
  const existing = JSON.parse(fs.readFileSync("events.json", "utf8"));

  // TODO: fetch/scrape new events here
  const events = existing.events || [];

  fs.writeFileSync(
    "events.json",
    JSON.stringify({ events }, null, 2) + "\n"
  );
}

refreshEvents().catch((err) => {
  console.error(err);
  process.exit(1);
});
