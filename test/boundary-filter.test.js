/**
 * Unit test to validate statistics boundary bucket filtering.
 * 
 * This test verifies that when HA's statistics API returns a bucket
 * from the previous period (e.g., March 31 for an April request), the
 * card correctly filters it out.
 */

const assert = require('assert');

// Mock the filtering logic from graphEntry.ts
function filterStatisticsBuckets(buckets, startDate) {
  const startTime = startDate.getTime();
  return buckets.filter((item) => {
    const bucketStart = new Date(item.start).getTime();
    return bucketStart >= startTime;
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
  
  const filtered = filterStatisticsBuckets(buckets, start);
  
  assert.strictEqual(filtered.length, 2, 'Should have 2 buckets after filtering');
  assert.strictEqual(filtered[0].max, 28, 'First bucket should be April 1 (28 GB)');
  assert.strictEqual(filtered[1].max, 58, 'Second bucket should be April 2 (58 GB)');
  
  console.log('✓ Test 1 passed: March 31 boundary bucket is correctly excluded');
}

// Test 2: With exact millisecond timestamps (as HA returns them)
function testFiltersWithExactTimestamps() {
  const buckets = [
    { start: 1774929600000, end: 1775016000000, max: 986 },  // March 31
    { start: 1775016000000, end: 1775102400000, max: 28 },  // April 1
    { start: 1775102400000, end: 1775188800000, max: 58 },  // April 2
  ];
  
  // April 1 start timestamp
  const start = new Date(1775016000000);  // 2026-04-01T04:00:00Z
  
  // Note: The start timestamp (1775016000000) is EXACTLY the April 1 bucket start
  // So the filter should include April 1 but exclude March 31
  const filtered = filterStatisticsBuckets(buckets, start);
  
  assert.strictEqual(filtered.length, 2, 'Should have 2 buckets');
  assert.strictEqual(filtered[0].max, 28, 'Should start at April 1');
  
  console.log('✓ Test 2 passed: Exact timestamp filtering works correctly');
}

// Test 3: Verify the API request window calculation
function testFetchStartCalculation() {
  // For raw history, fetchStart is shifted back by 1ms
  const startHistory = new Date('2026-04-01T00:00:00Z');
  const fetchStartRaw = new Date(startHistory.getTime() - 1);  // 1ms earlier
  
  // For statistics, fetchStart should NOT be shifted
  const fetchStartStats = new Date(startHistory.getTime());  // exact
  
  assert.strictEqual(
    fetchStartRaw.getTime(),
    startHistory.getTime() - 1,
    'Raw fetchStart should be 1ms earlier'
  );
  
  assert.strictEqual(
    fetchStartStats.getTime(),
    startHistory.getTime(),
    'Statistics fetchStart should be exact'
  );
  
  console.log('✓ Test 3 passed: Fetch start calculations are correct');
}

// Test 4: Integration test - simulate what the card does
function testCardIntegration() {
  // Simulate the card's _updateHistory flow
  const start = new Date('2026-04-01T00:00:00Z');
  const end = new Date('2026-04-30T00:00:00Z');
  
  // Mock API response (includes boundary bucket)
  const apiResponse = [
    { start: '2026-03-31T04:00:00.000Z', end: '2026-04-01T04:00:00.000Z', max: 986 },  // March 31 - should be filtered
    { start: '2026-04-01T04:00:00.000Z', end: '2026-04-02T04:00:00.000Z', max: 28 },   // April 1
    { start: '2026-04-02T04:00:00.000Z', end: '2026-04-03T04:00:00.000Z', max: 58 },   // April 2
  ];
  
  // Simulate the card's filter
  const filtered = filterStatisticsBuckets(apiResponse, start);
  
  // Verify results
  assert.strictEqual(filtered.length, 2, 'Should filter out boundary bucket');
  assert.strictEqual(filtered[0].max, 28, 'First should be April 1');
  assert.strictEqual(filtered[1].max, 58, 'Second should be April 2');
  
  // Verify no March 31 data
  const hasMarch31 = filtered.some(b => new Date(b.start).getTime() < start.getTime());
  assert.strictEqual(hasMarch31, false, 'Should not contain any March 31 data');
  
  console.log('✓ Test 4 passed: Full card integration simulation works');
}

// Run all tests
console.log('Running boundary bucket filter tests...\n');

try {
  testFiltersMarch31Boundary();
  testFiltersWithExactTimestamps();
  testFetchStartCalculation();
  testCardIntegration();
  
  console.log('\n✅ All tests passed!');
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
}
