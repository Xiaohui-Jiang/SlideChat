import React from 'react';
import type { JobResult } from '../lib/multiagent-api';

interface AnalysisResultsProps {
    result: JobResult;
    onClose?: () => void;
}

export const AnalysisResults: React.FC<AnalysisResultsProps> = ({ result, onClose }) => {
    if (!result || result.status !== 'completed') {
        return null;
    }

    return (
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold">Analysis Results</h3>
                        <p className="text-sm text-indigo-100">Job ID: {result.job_id.substring(0, 8)}...</p>
                    </div>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="text-white hover:text-indigo-100 transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="p-6">
                {/* Summary Section */}
                {result.summary && (
                    <div className="mb-6">
                        <h4 className="text-md font-semibold text-gray-800 mb-3">Summary</h4>
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                            <p className="text-gray-700 whitespace-pre-wrap">{result.summary}</p>
                        </div>
                    </div>
                )}

                {/* Download Links */}
                <div>
                    <h4 className="text-md font-semibold text-gray-800 mb-3">Download Files</h4>
                    <div className="grid gap-3">
                        {result.report_url && (
                            <a
                                href={result.report_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between p-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors group"
                            >
                                <div className="flex items-center space-x-3">
                                    <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center text-white">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-800">Text Report</p>
                                        <p className="text-sm text-gray-600">Detailed analysis report</p>
                                    </div>
                                </div>
                                <svg className="w-5 h-5 text-blue-600 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </a>
                        )}

                        {result.pdf_url && (
                            <a
                                href={result.pdf_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between p-4 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors group"
                            >
                                <div className="flex items-center space-x-3">
                                    <div className="w-10 h-10 bg-red-500 rounded-lg flex items-center justify-center text-white">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-800">PDF Report</p>
                                        <p className="text-sm text-gray-600">Figures and visualizations</p>
                                    </div>
                                </div>
                                <svg className="w-5 h-5 text-red-600 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </a>
                        )}

                        {result.log_url && (
                            <a
                                href={result.log_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between p-4 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg transition-colors group"
                            >
                                <div className="flex items-center space-x-3">
                                    <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center text-white">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-800">Analysis Log</p>
                                        <p className="text-sm text-gray-600">Execution details and logs</p>
                                    </div>
                                </div>
                                <svg className="w-5 h-5 text-green-600 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </a>
                        )}
                    </div>
                </div>

                {/* Status Badge */}
                <div className="mt-6 pt-4 border-t border-gray-200">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Status</span>
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Completed
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};
