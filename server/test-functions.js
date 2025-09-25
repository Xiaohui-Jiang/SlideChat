// Function testing script for LangChain integration
const { FunctionRegistry } = require('./lib/function-registry');
const { registerSlideFunctions } = require('./lib/slide-functions');

/**
 * Test runner for LangChain functions
 */
class FunctionTester {
  constructor() {
    this.registry = new FunctionRegistry();
    this.setupFunctions();
  }

  /**
   * Initialize all functions
   */
  setupFunctions() {
    console.log('Setting up functions...');
    registerSlideFunctions(this.registry);
    console.log(`Registered ${this.registry.list().length} functions\n`);
  }

  /**
   * Test individual function
   */
  async testFunction(functionName, input) {
    console.log(`Testing function: ${functionName}`);
    console.log('Input:', JSON.stringify(input, null, 2));
    
    try {
      const result = await this.registry.execute(functionName, input);
      console.log('✅ Success!');
      console.log('Output:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.log('❌ Error:', error.message);
      if (error.details) {
        console.log('Details:', error.details);
      }
      return null;
    }
  }

  /**
   * Test function with various inputs
   */
  async testFunctionWithCases(functionName, testCases) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Testing ${functionName} with multiple cases`);
    console.log(`${'='.repeat(50)}`);

    for (let i = 0; i < testCases.length; i++) {
      console.log(`\nTest case ${i + 1}:`);
      await this.testFunction(functionName, testCases[i]);
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🚀 Starting LangChain Function Tests');
    console.log('====================================');

    // List all available functions
    console.log('Available functions:');
    const functions = this.registry.list();
    functions.forEach(func => {
      console.log(`  - ${func.name}: ${func.description}`);
      console.log(`    Tags: ${func.tags.join(', ')}`);
    });

    // Test getSlideInfo
    await this.testFunctionWithCases('getSlideInfo', [
      { slideId: 'lung_01' },
      { slideId: 'liver_02' },
      { slideId: 'brain_03' },
      { slideId: 'nonexistent' }
    ]);

    // Test createROI
    await this.testFunctionWithCases('createROI', [
      { 
        slideId: 'lung_01', 
        name: 'tumor_region', 
        geometry: { x: 100, y: 200, w: 300, h: 250 } 
      },
      { 
        slideId: 'liver_02', 
        name: 'portal_area', 
        geometry: { x: 50, y: 75, w: 200, h: 150 } 
      },
      { 
        slideId: 'brain_03', 
        name: 'cortex_region', 
        geometry: { x: 200, y: 300, w: 400, h: 350 } 
      }
    ]);

    // Test analyzeBiologicalFeatures
    await this.testFunctionWithCases('analyzeBiologicalFeatures', [
      { slideId: 'lung_01', analysisType: 'morphology' },
      { slideId: 'lung_01', analysisType: 'staining' },
      { slideId: 'liver_02', analysisType: 'morphology' },
      { slideId: 'brain_03', analysisType: 'cellular' }
    ]);

    // Test findSimilarSlides
    await this.testFunctionWithCases('findSimilarSlides', [
      { slideId: 'lung_01', similarityType: 'morphology', threshold: 0.8 },
      { slideId: 'lung_01', similarityType: 'staining', threshold: 0.7 },
      { slideId: 'liver_02', similarityType: 'cellular', threshold: 0.9 },
      { slideId: 'brain_03', similarityType: 'morphology', threshold: 0.6 }
    ]);

    console.log('\n🎉 All function tests completed!');
  }

  /**
   * Test LangChain tool conversion
   */
  testLangChainTools() {
    console.log('\n' + '='.repeat(50));
    console.log('Testing LangChain tool conversion');
    console.log('='.repeat(50));

    try {
      const tools = this.registry.toLangChainTools();
      console.log(`✅ Successfully converted ${tools.length} functions to LangChain tools`);
      
      tools.forEach(tool => {
        console.log(`\nTool: ${tool.name}`);
        console.log(`Description: ${tool.description}`);
        console.log(`Schema keys: ${Object.keys(tool.schema.shape || {}).join(', ')}`);
      });
    } catch (error) {
      console.log('❌ LangChain tool conversion failed:', error.message);
    }
  }

  /**
   * Test input validation
   */
  async testValidation() {
    console.log('\n' + '='.repeat(50));
    console.log('Testing input validation');
    console.log('='.repeat(50));

    const invalidCases = [
      {
        function: 'getSlideInfo',
        input: {},  // Missing slideId
        expectedError: 'slideId is required'
      },
      {
        function: 'createROI',
        input: { slideId: 'test' },  // Missing name and geometry
        expectedError: 'name and geometry are required'
      },
      {
        function: 'analyzeBiologicalFeatures',
        input: { slideId: 'test', analysisType: 'invalid_type' },  // Invalid analysis type
        expectedError: 'Invalid analysis type'
      }
    ];

    for (const testCase of invalidCases) {
      console.log(`\nTesting validation for ${testCase.function}:`);
      const result = await this.testFunction(testCase.function, testCase.input);
      if (result === null) {
        console.log('✅ Validation correctly rejected invalid input');
      } else {
        console.log('❌ Validation should have failed but didn\'t');
      }
    }
  }
}

// Performance testing
async function performanceTest() {
  console.log('\n' + '='.repeat(50));
  console.log('Performance testing');
  console.log('='.repeat(50));

  const tester = new FunctionTester();
  const testInput = { slideId: 'lung_01' };
  const iterations = 100;

  console.log(`Running getSlideInfo ${iterations} times...`);
  const startTime = Date.now();

  for (let i = 0; i < iterations; i++) {
    await tester.testFunction('getSlideInfo', testInput);
  }

  const endTime = Date.now();
  const totalTime = endTime - startTime;
  const avgTime = totalTime / iterations;

  console.log(`✅ Performance test completed:`);
  console.log(`Total time: ${totalTime}ms`);
  console.log(`Average time per call: ${avgTime.toFixed(2)}ms`);
}

// Run tests if this script is executed directly
if (require.main === module) {
  async function runTests() {
    const tester = new FunctionTester();
    
    await tester.runAllTests();
    tester.testLangChainTools();
    await tester.testValidation();
    await performanceTest();
  }

  runTests().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { FunctionTester };
