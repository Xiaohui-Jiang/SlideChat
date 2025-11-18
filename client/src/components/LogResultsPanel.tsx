import React, { useState } from 'react';
import type { LogEntry, AnalysisResult } from '../types';

interface LogResultsPanelProps {
  logs: LogEntry[];
  results: AnalysisResult[];
  multiagentResult?: any;
  className?: string;
}

export const LogResultsPanel: React.FC<LogResultsPanelProps> = ({
  logs,
  results,
  multiagentResult,
  className = ''
}) => {
  const [activeTab, setActiveTab] = useState<'log' | 'results'>('log');

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).replace(' ', ' ');
  };

  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'error': return 'text-red-600';
      case 'warning': return 'text-yellow-600';
      case 'success': return 'text-green-600';
      default: return 'text-gray-600';
    }
  };

  const formatAnalysisData = (data: Record<string, any>) => {
    if (typeof data === 'object' && data !== null) {
      // Handle cell typing results
      if ('cell_counts' in data || 'percentages' in data) {
        return Object.entries(data).map(([key, value]) => {
          if (typeof value === 'object' && value !== null) {
            return Object.entries(value).map(([subKey, subValue]) => (
              <div key={`${key}-${subKey}`} className="flex justify-between">
                <span className="capitalize">{subKey.replace(/_/g, ' ')}:</span>
                <span className="font-mono">
                  {typeof subValue === 'number'
                    ? key === 'percentages'
                      ? `${subValue.toFixed(1)}%`
                      : subValue.toLocaleString()
                    : String(subValue)
                  }
                </span>
              </div>
            ));
          }
          return (
            <div key={key} className="flex justify-between">
              <span className="capitalize">{key.replace(/_/g, ' ')}:</span>
              <span className="font-mono">{String(value)}</span>
            </div>
          );
        });
      }

      // Handle general object data
      return Object.entries(data).map(([key, value]) => (
        <div key={key} className="flex justify-between text-sm">
          <span className="capitalize">{key.replace(/_/g, ' ')}:</span>
          <span className="font-mono">
            {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
          </span>
        </div>
      ));
    }

    return <div className="text-sm text-gray-600">{String(data)}</div>;
  };

  const getResultTypeLabel = (type: AnalysisResult['type']) => {
    switch (type) {
      case 'cell_typing': return 'Cell Typing';
      case 'feature_analysis': return 'Feature Analysis';
      case 'similarity_search': return 'Similarity Search';
      case 'roi_analysis': return 'ROI Analysis';
      default: return 'Analysis';
    }
  };

  return (
    <div className={`flex flex-col h-full bg-white border-t ${className}`}>
      {/* Tab Headers */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('log')}
          className={`flex-1 px-4 py-2 text-sm font-medium ${activeTab === 'log'
              ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700'
              : 'text-gray-600 hover:text-gray-800'
            }`}
        >
          Log
        </button>
        <button
          onClick={() => setActiveTab('results')}
          className={`flex-1 px-4 py-2 text-sm font-medium ${activeTab === 'results'
              ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700'
              : 'text-gray-600 hover:text-gray-800'
            }`}
        >
          Results
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'log' && (
          <div className="h-full overflow-y-auto p-3">
            <div className="space-y-2">
              {logs.length === 0 ? (
                <div className="text-gray-500 text-sm text-center py-4">
                  No log entries yet
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 text-sm">
                    <span className="text-xs text-gray-400 font-mono shrink-0 mt-0.5">
                      [{formatTimestamp(log.timestamp)}]
                    </span>
                    <span className={`${getLevelColor(log.level)} flex-1`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'results' && (
          <div className="h-full overflow-y-auto p-3">
            {/* Multiagent Analysis Results */}
            {multiagentResult && multiagentResult.status === 'completed' && (
              <div className="mb-4 border-2 border-indigo-200 rounded-lg bg-gradient-to-br from-indigo-50 to-purple-50">
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-3 rounded-t-lg">
                  <h3 className="font-semibold text-sm">Analysis Results</h3>
                  <p className="text-xs text-indigo-100">Job ID: {multiagentResult.job_id?.substring(0, 8)}...</p>
                </div>

                <div className="p-4">
                  {/* Summary */}
                  {multiagentResult.summary && (
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-gray-800 mb-2">Summary</h4>
                      <div className="bg-white rounded p-3 text-sm text-gray-700 whitespace-pre-wrap border border-gray-200">
                        {multiagentResult.summary}
                      </div>
                    </div>
                  )}

                  {/* Download Links */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Download Files</h4>
                    <div className="space-y-2">
                      {multiagentResult.report_url && (
                        <a
                          href={multiagentResult.report_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors text-sm group"
                        >
                          <div className="flex items-center space-x-2">
                            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="font-medium text-gray-800">Text Report</span>
                          </div>
                          <svg className="w-4 h-4 text-blue-600 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </a>
                      )}

                      {multiagentResult.pdf_url && (
                        <a
                          href={multiagentResult.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-red-50 hover:bg-red-100 border border-red-200 rounded transition-colors text-sm group"
                        >
                          <div className="flex items-center space-x-2">
                            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium text-gray-800">PDF Report</span>
                          </div>
                          <svg className="w-4 h-4 text-red-600 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </a>
                      )}

                      {multiagentResult.log_url && (
                        <a
                          href={multiagentResult.log_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-green-50 hover:bg-green-100 border border-green-200 rounded transition-colors text-sm group"
                        >
                          <div className="flex items-center space-x-2">
                            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="font-medium text-gray-800">Analysis Log</span>
                          </div>
                          <svg className="w-4 h-4 text-green-600 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Original Results */}
            <div className="space-y-4">
              {results.length === 0 && (!multiagentResult || multiagentResult.status !== 'completed') ? (
                <div className="text-gray-500 text-sm text-center py-4">
                  No analysis results yet
                </div>
              ) : (
                results.map((result) => (
                  <div key={result.id} className="border rounded-lg p-4 bg-gray-50">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="font-medium text-sm">
                          {getResultTypeLabel(result.type)}
                        </h4>
                        <div className="text-xs text-gray-500">
                          {formatTimestamp(result.timestamp)}
                        </div>
                      </div>
                      {result.roiId && (
                        <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                          ROI Analysis
                        </span>
                      )}
                    </div>

                    <div className="space-y-2">
                      {formatAnalysisData(result.data)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};