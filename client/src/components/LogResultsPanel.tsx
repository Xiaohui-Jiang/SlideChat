import React, { useState } from 'react';
import type { LogEntry, AnalysisResult } from '../types';

interface LogResultsPanelProps {
  logs: LogEntry[];
  results: AnalysisResult[];
  className?: string;
}

export const LogResultsPanel: React.FC<LogResultsPanelProps> = ({
  logs,
  results,
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
          className={`flex-1 px-4 py-2 text-sm font-medium ${
            activeTab === 'log' 
              ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700' 
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Log
        </button>
        <button
          onClick={() => setActiveTab('results')}
          className={`flex-1 px-4 py-2 text-sm font-medium ${
            activeTab === 'results' 
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
            <div className="space-y-4">
              {results.length === 0 ? (
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