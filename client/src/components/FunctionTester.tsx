import React, { useState, useEffect } from 'react';
import { langchainApi, LangChainFunction, FunctionExecutionResult, ExamplesResponse } from '../lib/langchain-api';

interface FunctionTesterProps {
  className?: string;
}

/**
 * Component for testing LangChain functions
 */
export const FunctionTester: React.FC<FunctionTesterProps> = ({ className = '' }) => {
  const [functions, setFunctions] = useState<LangChainFunction[]>([]);
  const [selectedFunction, setSelectedFunction] = useState<string>('');
  const [chatMessage, setChatMessage] = useState<string>('');
  const [chatResponse, setChatResponse] = useState<string>('');
  const [examples, setExamples] = useState<ExamplesResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [results, setResults] = useState<Record<string, any>>({});

  // Load functions and examples on mount
  useEffect(() => {
    loadFunctions();
    loadExamples();
  }, []);

  const loadFunctions = async () => {
    try {
      const funcs = await langchainApi.getFunctions();
      setFunctions(funcs);
    } catch (err) {
      setError(`Failed to load functions: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const loadExamples = async () => {
    try {
      const exampleData = await langchainApi.getExamples();
      setExamples(exampleData);
    } catch (err) {
      console.warn('Failed to load examples:', err);
    }
  };

  const executeFunction = async (functionName: string) => {
    setLoading(true);
    setError('');

    try {
      const result: FunctionExecutionResult = await langchainApi.testFunction(functionName);
      setResults(prev => ({
        ...prev,
        [functionName]: result
      }));
    } catch (err) {
      setError(`Function execution failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatMessage.trim()) return;

    setLoading(true);
    setError('');

    try {
      const response = await langchainApi.chat(chatMessage);
      setChatResponse(response.reply);
    } catch (err) {
      setError(`Chat failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`p-6 bg-white rounded-lg shadow-lg ${className}`}>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">LangChain Function Tester</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Chat Interface */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3">Chat with LangChain Agent</h3>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder="Ask about slides, ROI analysis, or biological features..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
          />
          <button
            onClick={sendChatMessage}
            disabled={loading || !chatMessage.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>

        {chatResponse && (
          <div className="p-3 bg-gray-50 border rounded-md">
            <p className="text-sm text-gray-600 mb-1">Response:</p>
            <p className="text-gray-800">{chatResponse}</p>
          </div>
        )}
      </div>

      {/* Function Testing */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3">Test Individual Functions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {functions.map((func) => (
            <div key={func.name} className="border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-medium text-gray-800">{func.name}</h4>
                <button
                  onClick={() => executeFunction(func.name)}
                  disabled={loading}
                  className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                >
                  Test
                </button>
              </div>

              <p className="text-sm text-gray-600 mb-2">{func.description}</p>

              {func.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {func.tags.map((tag) => (
                    <span key={tag} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {results[func.name] && (
                <div className="mt-3 p-2 bg-gray-50 rounded text-sm">
                  <p className="font-medium mb-1">Result:</p>
                  <pre className="text-xs overflow-x-auto">
                    {JSON.stringify(results[func.name], null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Usage Examples */}
      {examples && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Usage Examples</h3>
          <div className="space-y-3">
            {examples.examples.map((example, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <span className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded font-medium">
                    {example.type}
                  </span>
                  <button
                    onClick={() => setChatMessage(example.query)}
                    className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
                  >
                    Use Query
                  </button>
                </div>

                <p className="text-sm text-gray-800 mb-2 font-medium">{example.query}</p>
                <p className="text-xs text-gray-600 mb-2">{example.description}</p>

                <div className="flex flex-wrap gap-1">
                  <span className="text-xs text-gray-500">Expected functions:</span>
                  {example.expected_functions.map((funcName) => (
                    <span key={funcName} className="px-1 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded">
                      {funcName}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-lg">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
            <p className="mt-2 text-sm text-gray-600">Processing...</p>
          </div>
        </div>
      )}
    </div>
  );
};