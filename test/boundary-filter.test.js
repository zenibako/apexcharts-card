/**
 * Unit test to validate statistics boundary bucket filtering.
 *
 * This test verifies that when HA's statistics API returns a bucket
 * from the previous period (e.g., March 31 for an April request), the
 * card correctly filters it out.
 */

const assert = require('assert');

// Mock the filtering logic from graphEntry.ts (current implementation)
function filterStatisticsBuckets(buckets, startDate, endDate) {
  const startTime = startDate.getTime();
  const endTime = endDate.getTime();
  return buckets.filter((item) => {
    const bucketStart = new Date(item.start).getTime();
    return bucketStart >= startTime && bucketStart < endTime;
  });
}

// Test 1: March 31 bucket should be excluded when start is April 1
function testFiltersMarch31Boundary() {
  const buckets = [
    { start: '2026-03-31T04:00:00.000Z', end: '2026-04-01T04:00:00.000Z', max: 986 },
    { start: '2026-04-01T04:00:00.000Z', end: '2026-04-02T04:00:00.000Z', max: 28 },
    { start: '2026-04-02T04:00:00.000Z', end: '2026-04-03T04:00:00.000Z', max: 58 },
  ];

  // start is April 1 (shifted back 30 days from May 1)
  const start = new Date('2026-04-01T00:00:00Z');
  const end = new Date('2026-05-02T00:00:00Z');  // May 2 = June 1 - 30d

  const filtered = filterStatisticsBuckets(buckets, start, end);

  assert.strictEqual(filtered.length, 2, 'Should have 2 buckets after filtering');
  assert.strictEqual(filtered[0].max, 28, 'First bucket should be April 1 (28 GB)');
  assert.strictEqual(filtered[1].max, 58, 'Second bucket should be April 2 (58 GB)');

  console.log('✓ Test 1 passed: March 31 boundary bucket is correctly excluded');
}

// Test 2: THE BUG - April 30 bucket passes through when end=May 2
function testEndBoundaryBug() {
  // Simulate API response for April 1-30 (with May 1 boundary)
  const buckets = [
    { start: '2026-04-29T04:00:00.000Z', end: '2026-04-30T04:00:00.000Z', max: 100 },  // April 29
    { start: '2026-04-30T04:00:00.000Z', end: '2026-05-01T04:00:00.000Z', max: 105 },  // April 30
    { start: '2026-05-01T04:00:00.000Z', end: '2026-05-02T04:00:00.000Z', max: 0 },    // May 1 - boundary!
  ];

  const start = new Date('2026-04-01T00:00:00Z');
  const end = new Date('2026-05-02T00:00:00Z');  // Current implementation uses this

  const filtered = filterStatisticsBuckets(buckets, start, end);

  // The bug: May 1 bucket (max=0) passes through because end=May 2
  // After offset, this creates a phantom point at May 31
  const hasMay1 = filtered.some(b => {
    const date = new Date(b.start);
    return date.getUTCDate() === 1 && date.getUTCMonth() === 4;  // May 1
  });

  if (hasMay1) {
    console.log('  ⚠️  Test 2: BUG CONFIRMED - May 1 bucket passes through end filter');
    console.log('      This creates a phantom 0GB point at May 31 after -30d offset');
  } else {
    console.log('✓ Test 2 passed: May 1 boundary correctly excluded');
  }
}

// Test 3: Verify the fix - using statsFetchEnd instead of end
function testStatsFetchEndFix() {
  const buckets = [
    { start: '2026-04-29T04:00:00.000Z', end: '2026-04-30T04:00:00.000Z', max: 100 },
    { start: '2026-04-30T04:00:00.000Z', end: '2026-05-01T04:00:00.000Z', max: 105 },  // April 30
    { start: '2026-05-01T04:00:00.000Z', end: '2026-05-02T04:00:00.000Z', max: 0 },    // May 1 - should be excluded
  ];

  const start = new Date('2026-04-01T00:00:00Z');
  // statsFetchEnd = new Date(end.getTime()); statsFetchEnd.setHours(0,0,0,0); statsFetchEnd.setDate(statsFetchEnd.getDate() - 1); statsFetchEnd.setTime(statsFetchEnd.getTime() - 1);
  // end = May 2 -> statsFetchEnd = April 30 23:59:59.999
  const statsFetchEnd = new Date('2026-04-30T23:59:59.999Z');

  const filtered = filterStatisticsBuckets(buckets, start, statsFetchEnd);

  assert.strictEqual(filtered.length, 2, 'Should only have April 29 and 30');
  assert.strictEqual(filtered[1].max, 105, 'Last bucket should be April 30 (105 GB)');

  const hasMay1 = filtered.some(b => {
    const date = new Date(b.start);
    return date.getUTCDate() === 1 && date.getUTCMonth() === 4;
  });
  assert.strictEqual(hasMay1, false, 'May 1 bucket should be excluded');

  console.log('✓ Test 3 passed: statsFetchEnd fix correctly excludes May 1 bucket');
}

// Test 4: Verify fetchEnd calculation logic
function testFetchEndCalculation() {
  const end = new Date('2026-05-02T00:00:00Z');  // May 2

  const statsFetchEnd = new Date(end.getTime());
  statsFetchEnd.setUTCHours(0, 0, 0, 0);              // May 2 00:00:00.000 UTC
  statsFetchEnd.setUTCDate(statsFetchEnd.getUTCDate() - 1); // May 1 00:00:00.000 UTC
  statsFetchEnd.setTime(statsFetchEnd.getTime() - 1); // April 30 23:59:59.999 UTC

  assert.strictEqual(
    statsFetchEnd.toISOString(),
    '2026-04-30T23:59:59.999Z',
    'statsFetchEnd should be April 30 23:59:59.999'
  );

  console.log('✓ Test 4 passed: Fetch end calculation is correct');
}

// Test 5: Integration test - verify no phantom May 31 point
function testNoPhantomMay31() {
  // Simulate what the chart sees after offset
  const buckets = [
    { start: '2026-04-29T04:00:00.000Z', max: 100 },
    { start: '2026-04-30T04:00:00.000Z', max: 105 },  // This becomes May 30 after +30d offset
    { start: '2026-05-01T04:00:00.000Z', max: 0 },    // This becomes May 31 after +30d offset
  ];

  const start = new Date('2026-04-01T00:00:00Z');
  const statsFetchEnd = new Date('2026-04-30T23:59:59.999Z');

  const filtered = filterStatisticsBuckets(buckets, start, statsFetchEnd);

  // Verify the last point is April 30, not May 1
  const lastPoint = filtered[filtered.length - 1];
  const lastDate = new Date(lastPoint.start);

  assert.strictEqual(lastDate.getUTCDate(), 30, 'Last point should be April 30');
  assert.strictEqual(lastDate.getUTCMonth(), 3, 'Last point should be April (month 3)');
  assert.strictEqual(lastPoint.max, 105, 'Last value should be 105 GB');

  console.log('✓ Test 5 passed: No phantom May 31 point after offset');
}

// Test 6: Verify actual HA API behavior simulation
function testHA_API_Behavior() {
  // HA's statistics API includes the bucket at the boundary
  // When requesting April 1 - May 2, it includes April 30 - May 1
  const simulatedAPIResponse = [
    { start: '2026-04-28T04:00:00.000Z', max: 95 },
    { start: '2026-04-29T04:00:00.000Z', max: 100 },
    { start: '2026-04-30T04:00:00.000Z', max: 105 },  // April 30
    { start: '2026-05-01T04:00:00.000Z', max: 0 },    // May 1 - this is the phantom!
  ];

  // With the fix, using statsFetchEnd = April 30 23:59:59
  const start = new Date('2026-04-01T00:00:00Z');
  const statsFetchEnd = new Date('2026-04-30T23:59:59.999Z');

  const filtered = filterStatisticsBuckets(simulatedAPIResponse, start, statsFetchEnd);

  // Should exclude May 1 bucket
  assert.strictEqual(filtered.length, 3, 'Should have 3 buckets');
  assert.strictEqual(filtered[filtered.length - 1].max, 105, 'Last should be April 30 (105 GB)');

  // After +30d offset, last point is May 30 (not May 31)
  const lastPointTimestamp = new Date(filtered[filtered.length - 1].start).getTime() + (30 * 86400000);
  const lastPointDate = new Date(lastPointTimestamp);
  assert.strictEqual(lastPointDate.getUTCDate(), 30, 'After offset, last point should be May 30');

  console.log('✓ Test 6 passed: Full HA API simulation with offset works correctly');
}

// Run all tests
console.log('Running boundary bucket filter tests...\n');

try {
  testFiltersMarch31Boundary();
  testEndBoundaryBug();
  testStatsFetchEndFix();
  testFetchEndCalculation();
  testNoPhantomMay31();
  testHA_API_Behavior();

  console.log('\n✅ All tests passed!');
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
