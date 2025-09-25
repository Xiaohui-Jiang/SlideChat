// Simplified function testing script for LangChain tools
import { 
  getSlideInfoTool, 
  createROITool, 
  analyzeBiologicalFeaturesTool, 
  findSimilarSlidesTool 
} from './lib/slide-functions.js';

/**
 * Test runner for LangChain tools
 */
class ToolTester {
  constructor() {
    this.tools = [
      getSlideInfoTool,
      createROITool,
      analyzeBiologicalFeaturesTool,
      findSimilarSlidesTool
    ];
  }

  /**
   * Test individual tool
   */
  async testTool(toolName, input) {
    console.log(`\n🧪 Testing tool: ${toolName}`);
    console.log('📄 Input:', JSON.stringify(input, null, 2));
    
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) {
      console.log('❌ Tool not found');
      return;
    }
    
    try {
      const startTime = Date.now();
      const result = await tool.func(input);
      const duration = Date.now() - startTime;
      
      console.log('✅ Success!');
      console.log('⏱️  Duration:', `${duration}ms`);
      console.log('📋 Result:', result);
      return JSON.parse(result);
    } catch (error) {
      console.log('❌ Error:', error.message);
      throw error;
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🚀 Starting LangChain tool tests...\n');

    const tests = [
      {
        name: 'getSlideInfo',
        input: { slide_id: 'lung_01' }
      },
      {
        name: 'createROI',
        input: { 
          slide_id: 'lung_01', 
          name: 'tumor_region', 
          geometry: { x: 100, y: 200, width: 300, height: 250 }
        }
      },
      {
        name: 'analyzeBiologicalFeatures',
        input: { 
          slide_id: 'lung_01', 
          analysis_type: 'morphology' 
        }
      },
      {
        name: 'findSimilarSlides',
        input: { 
          slide_id: 'lung_01', 
          similarity_type: 'morphology',
          threshold: '0.8',
          max_results: '3'
        }
      }
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      try {
        await this.testTool(test.name, test.input);
        passed++;
      } catch (error) {
        failed++;
        console.log(`💥 Test ${test.name} failed:`, error.message);
      }
      
      // Add small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n📊 Test Results:`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📋 Total: ${tests.length}`);

    return { passed, failed, total: tests.length };
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new ToolTester();
  
  tester.runAllTests()
    .then(results => {
      if (results.failed === 0) {
        console.log('\n🎉 All tests passed!');
        process.exit(0);
      } else {
        console.log(`\n⚠️  ${results.failed} test(s) failed`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 Test runner failed:', error);
      process.exit(1);
    });
}

export { ToolTester };