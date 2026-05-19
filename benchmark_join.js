const COUNT = 5000;
const fragments = [];
for (let i = 0; i < COUNT; i++) {
  fragments.push(JSON.stringify({
    id: i,
    title: 'Suggestion ' + i,
    description: 'Description ' + i,
    agent: 'agent',
    status: 'pending',
    created_at: '2023-01-01 00:00:00',
    updated_at: '2023-01-01 00:00:00'
  }));
}

const iterations = 1000;

let startTime = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) {
  const res = '[' + fragments.join(',') + ']';
}
let endTime = process.hrtime.bigint();
console.log(`Average join time: ${(Number(endTime - startTime) / iterations / 1000000).toFixed(4)}ms`);

startTime = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) {
  const pendingFragments = [];
  for (let j = 0; j < COUNT; j++) {
    pendingFragments.push(fragments[j]);
  }
  const res = '[' + pendingFragments.push(',') + ']';
}
endTime = process.hrtime.bigint();
console.log(`Average loop + push + join time: ${(Number(endTime - startTime) / iterations / 1000000).toFixed(4)}ms`);
