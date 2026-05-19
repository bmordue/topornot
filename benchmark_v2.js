const COUNT = 5000;
const fragments = [];
for (let i = 0; i < COUNT; i++) {
  fragments.push(JSON.stringify({id: i, title: 'S'+i, status: 'pending'}));
}

function currentWay() {
  const reversed = [];
  for (let i = COUNT - 1; i >= 0; i--) {
    reversed.push(fragments[i]);
  }
  return '[' + reversed.join(',') + ']';
}

const cacheArray = [...fragments].reverse();
function newWay() {
  return '[' + cacheArray.join(',') + ']';
}

const iterations = 1000;
let start = process.hrtime.bigint();
for(let i=0; i<iterations; i++) currentWay();
let end = process.hrtime.bigint();
console.log('Current way (loop+push+join): ' + (Number(end-start)/iterations/1000000).toFixed(4) + 'ms');

start = process.hrtime.bigint();
for(let i=0; i<iterations; i++) newWay();
end = process.hrtime.bigint();
console.log('New way (just join): ' + (Number(end-start)/iterations/1000000).toFixed(4) + 'ms');
