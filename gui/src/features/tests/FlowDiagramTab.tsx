import React, { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import mermaid from 'mermaid';
import * as api from '@/lib/api';

export interface FlowDiagramTabProps {
  testId: string;
}

/**
 * FlowDiagramTab - Render Mermaid flowchart visualization
 *
 * Features:
 * - Fetches diagram from API via getFlowDiagram()
 * - Renders Mermaid diagram using mermaid.render()
 * - Zoom controls (in/out/reset)
 * - Refresh button to regenerate diagram
 * - Supports dark mode
 */
export const FlowDiagramTab: React.FC<FlowDiagramTabProps> = ({ testId }) => {
  const [diagram, setDiagram] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize Mermaid
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
      },
    });
  }, []);

  // Load diagram
  useEffect(() => {
    loadDiagram();
  }, [testId]);

  // Render diagram when it changes and container is available
  useEffect(() => {
    if (diagram && containerRef.current && !isLoading) {
      renderDiagram(diagram);
    }
  }, [diagram, isLoading]);

  const loadDiagram = async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log('Loading diagram for test:', testId);
      const diagramSyntax = await api.getFlowDiagram(testId);
      console.log('Diagram syntax received');
      setDiagram(diagramSyntax);
    } catch (error: any) {
      console.error('Failed to load diagram:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const renderDiagram = async (diagramSyntax: string) => {
    if (!containerRef.current) {
      console.error('Container ref not available');
      return;
    }

    try {
      console.log('Rendering diagram with Mermaid...');
      const { svg } = await mermaid.render('mermaid-diagram', diagramSyntax);
      console.log('Diagram rendered successfully');
      containerRef.current.innerHTML = svg;
    } catch (error: any) {
      console.error('Mermaid render error:', error);
      setError(`Failed to render diagram: ${error.message}`);
    }
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.2, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.2, 0.5));
  const handleZoomReset = () => setZoom(1);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-start justify-start py-12 px-8 w-full">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="h-8 w-8 text-red-600" />
          <div>
            <p className="text-red-600 font-semibold">Mermaid Render Error</p>
            <p className="text-sm text-gray-600">{error}</p>
          </div>
        </div>
        <button
          onClick={loadDiagram}
          className="mb-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm"
        >
          Retry
        </button>
        {diagram && (
          <div className="w-full">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">Mermaid Syntax (for debugging):</h3>
              <button
                onClick={() => navigator.clipboard.writeText(diagram)}
                className="px-3 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
              >
                Copy to Clipboard
              </button>
            </div>
            <pre className="text-xs bg-gray-100 p-4 rounded border border-gray-300 overflow-x-auto max-h-96 overflow-y-auto">
              {diagram}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between bg-gray-50 p-4 rounded-lg">
        <div className="flex items-center gap-2">
          <button
            onClick={handleZoomOut}
            className="p-2 bg-white hover:bg-gray-100 rounded-md"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-sm text-gray-600 min-w-[4rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-2 bg-white hover:bg-gray-100 rounded-md"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={handleZoomReset}
            className="px-3 py-2 bg-white hover:bg-gray-100 rounded-md text-sm"
          >
            Reset
          </button>
        </div>

        <button
          onClick={loadDiagram}
          className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-gray-100 rounded-md text-sm"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Diagram container */}
      <div className="bg-white border border-gray-200 rounded-lg p-8 overflow-auto">
        <div
          ref={containerRef}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          className="mermaid-container"
        />
      </div>
    </div>
  );
};

export default FlowDiagramTab;
