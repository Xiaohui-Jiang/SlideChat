// Server testing script for LangChain functions
const http = require('http');
const querystring = require('querystring');
const { execSync } = require('child_process');

class ServerTester {
  constructor(host = 'localhost', port = 3001) {
    this.host = host;
    this.port = port;
    this.baseUrl = `http://${host}:${port}`;
  }

  /**
   * Make HTTP request
   */
  async makeRequest(path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.host,
        port: this.port,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const jsonBody = body ? JSON.parse(body) : null;
            resolve({
              statusCode: res.statusCode,
              body: jsonBody,
              rawBody: body
            });
          } catch (err) {
            resolve({
              statusCode: res.statusCode,
              body: null,
              rawBody: body
            });
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (data) {
        req.write(JSON.stringify(data));
      }
      req.end();
    });
  }

  /**
   * Test server connection
   */
  async testConnection() {
    console.log('Testing server connection...');
    try {
      const response = await this.makeRequest('/api/health');
      if (response.statusCode === 200) {
        console.log('✅ Server connection successful');
        return true;
      } else {
        console.log(`❌ Server returned status: ${response.statusCode}`);
        return false;
      }
    } catch (error) {
      console.log(`❌ Server connection failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Test function list endpoint
   */
  async testFunctionList() {
    console.log('\nTesting function list endpoint...');
    try {
      const response = await this.makeRequest('/api/functions');
      if (response.statusCode === 200 && Array.isArray(response.body)) {
        console.log(`✅ Retrieved ${response.body.length} functions:`);
        response.body.forEach(func => {
          console.log(`  - ${func.name}: ${func.description}`);
        });
        return response.body;
      } else {
        console.log(`❌ Failed to get functions. Status: ${response.statusCode}`);
        return null;
      }
    } catch (error) {
      console.log(`❌ Function list test failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Test individual function execution
   */
  async testFunctionExecution(functionName, input) {
    console.log(`\nTesting function execution: ${functionName}`);
    try {
      const response = await this.makeRequest(
        `/api/functions/${functionName}/execute`,
        'POST',
        { input }
      );
      
      if (response.statusCode === 200 && response.body.success) {
        console.log(`✅ Function ${functionName} executed successfully:`);
        console.log(JSON.stringify(response.body.data, null, 2));
        return response.body.data;
      } else {
        console.log(`❌ Function ${functionName} execution failed:`);
        console.log(`Status: ${response.statusCode}`);
        if (response.body) {
          console.log('Error:', response.body.error || response.body.message);
        }
        return null;
      }
    } catch (error) {
      console.log(`❌ Function execution test failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Test chat endpoint
   */
  async testChat(message) {
    console.log(`\nTesting chat with message: "${message}"`);
    try {
      const response = await this.makeRequest('/api/chat', 'POST', { message });
      
      if (response.statusCode === 200 && response.body.reply) {
        console.log(`✅ Chat response received:`);
        console.log(`Reply: ${response.body.reply}`);
        console.log(`Source: ${response.body.source}`);
        if (response.body.context) {
          console.log('Context:', JSON.stringify(response.body.context, null, 2));
        }
        return response.body;
      } else {
        console.log(`❌ Chat test failed. Status: ${response.statusCode}`);
        if (response.body) {
          console.log('Error:', response.body.error);
        }
        return null;
      }
    } catch (error) {
      console.log(`❌ Chat test failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Test usage examples endpoint
   */
  async testExamples() {
    console.log('\nTesting usage examples endpoint...');
    try {
      const response = await this.makeRequest('/api/examples');
      if (response.statusCode === 200 && response.body.examples) {
        console.log(`✅ Retrieved ${response.body.examples.length} examples:`);
        response.body.examples.forEach((example, index) => {
          console.log(`  ${index + 1}. [${example.type}] ${example.query}`);
        });
        return response.body.examples;
      } else {
        console.log(`❌ Failed to get examples. Status: ${response.statusCode}`);
        return null;
      }
    } catch (error) {
      console.log(`❌ Examples test failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🚀 Starting LangChain Server Tests');
    console.log('=====================================');

    // Test server connection
    const connected = await this.testConnection();
    if (!connected) {
      console.log('\n❌ Cannot proceed with tests - server is not responding');
      return;
    }

    // Test function list
    const functions = await this.testFunctionList();
    if (!functions) {
      console.log('\n❌ Cannot proceed with function tests');
      return;
    }

    // Test individual functions with sample data
    const testCases = [
      {
        name: 'getSlideInfo',
        input: { slideId: 'lung_01' }
      },
      {
        name: 'createROI',
        input: { 
          slideId: 'lung_01', 
          name: 'test_region', 
          geometry: { x: 100, y: 200, w: 300, h: 250 } 
        }
      },
      {
        name: 'analyzeBiologicalFeatures',
        input: { 
          slideId: 'lung_01', 
          analysisType: 'morphology' 
        }
      },
      {
        name: 'findSimilarSlides',
        input: { 
          slideId: 'lung_01', 
          similarityType: 'morphology', 
          threshold: 0.8 
        }
      }
    ];

    for (const testCase of testCases) {
      await this.testFunctionExecution(testCase.name, testCase.input);
    }

    // Test chat functionality
    const chatMessages = [
      'Get information about slide lung_01',
      'Create a new ROI in slide lung_01 at position x:150, y:250 with size 400x300',
      'Analyze biological features in slide lung_01',
      'Find slides similar to lung_01 based on morphology'
    ];

    for (const message of chatMessages) {
      await this.testChat(message);
    }

    // Test examples
    await this.testExamples();

    console.log('\n🎉 All tests completed!');
    console.log('=====================================');
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  const tester = new ServerTester();
  
  // Check if server is running
  console.log('Checking if server is running...');
  
  tester.runAllTests().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { ServerTester };
