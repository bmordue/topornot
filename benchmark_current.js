const db = require('./db');
const fs = require('fs');
const path = require('path');

process.env.DB_PATH = path.join(__dirname, 'benchmark_suggestions.json');

async function run() {
  if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);

  const COUNT = 5000;
  console.log(`Generating ${COUNT} suggestions...`);
  for (let i = 0; i < COUNT; i++) {
    db.createSuggestion({
      title: 'Suggestion ' + i,
      description: 'Description ' + i,
      agent: 'agent'
    });
  }
  db.flush();

  const iterations = 50;
  console.log(`Running ${iterations} iterations...`);

  let pendingReadTime = 0;
  let allReadTime = 0;

  for (let i = 0; i < iterations; i++) {
    // Current behavior: update invalidates
    db.updateStatus(i + 1, 'approved', 'user');

    let start = process.hrtime.bigint();
    db.getPendingSuggestionsJson();
    let end = process.hrtime.bigint();
    pendingReadTime += Number(end - start);

    db.updateStatus(COUNT - i, 'approved', 'user');
    start = process.hrtime.bigint();
    db.getAllSuggestionsJson();
    end = process.hrtime.bigint();
    allReadTime += Number(end - start);
  }

  console.log(`Average getPendingSuggestionsJson time after update: ${(pendingReadTime / iterations / 1000000).toFixed(4)}ms`);
  console.log(`Average getAllSuggestionsJson time after update: ${(allReadTime / iterations / 1000000).toFixed(4)}ms`);

  db.closeDb();
  if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
}

run();
