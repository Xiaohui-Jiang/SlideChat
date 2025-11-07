import React, { useEffect, useState, useCallback } from 'react';
import { ProjectPanel } from './ProjectPanel';
import ImageViewerPanel from './ImageViewerPanel';
import { LogResultsPanel } from './LogResultsPanel';
import { ChatPanel } from './ChatPanel';
import type { 
  Project, 
  Image, 
  ROI, 
  ChatMessage, 
  LogEntry, 
  AnalysisResult,
  Slide 
} from '../types';
import { 
  fetchSlides, 
  sendChat, 
  uploadSlideToServer, 
  fetchImageROIs, 
  createImageROI,
  DEFAULT_PROJECT_ID
} from '../lib/api';

export const Workspace: React.FC = () => {
  // Core state
  const [projects, setProjects] = useState<Project[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [rois, setROIs] = useState<ROI[]>([]);
  
  // Selection state
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedImage, setSelectedImage] = useState<Image | null>(null);
  const [selectedROI, setSelectedROI] = useState<ROI | null>(null);

  // UI state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Hello! What would you like to do with this sample?',
      ts: Date.now(),
    },
  ]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Initialize with demo data
  useEffect(() => {
    initializeWorkspace();
  }, []);

  const initializeWorkspace = async () => {
    try {
      // Create a demo project
      const demoProject: Project = {
        id: 'demo-project',
        name: 'Xenium Renal Cell Carcinoma',
        description: 'Spatial transcriptomics and pathology analysis of renal cell carcinoma tissue',
        createdAt: Date.now(),
        imageIds: []
      };

      // Load slides and convert to images
      const slides = await fetchSlides();
      const demoImages: Image[] = slides.map((slide: Slide) => ({
        ...slide,
        projectId: demoProject.id
      }));

      // Update project with image IDs
      demoProject.imageIds = demoImages.map(img => img.id);

      setProjects([demoProject]);
      setImages(demoImages);
      setSelectedProject(demoProject);
      
      if (demoImages.length > 0) {
        setSelectedImage(demoImages[0]);
      }

      addLog('info', 'New project created');
      addLog('info', `Loaded ${demoImages.length} images`);
    } catch (error) {
      console.error('Failed to initialize workspace:', error);
      addLog('error', 'Failed to initialize workspace');
    }
  };

  // Utility functions
  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    const logEntry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      level,
      message
    };
    setLogs(prev => [...prev, logEntry]);
  }, []);

  const addResult = useCallback((result: Omit<AnalysisResult, 'id' | 'timestamp'>) => {
    const analysisResult: AnalysisResult = {
      ...result,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    };
    setResults(prev => [...prev, analysisResult]);
  }, []);

  // Project management
  const handleCreateProject = useCallback((name: string, description?: string) => {
    const newProject: Project = {
      id: crypto.randomUUID(),
      name,
      description,
      createdAt: Date.now(),
      imageIds: []
    };
    
    setProjects(prev => [...prev, newProject]);
    setSelectedProject(newProject);
    addLog('info', `Created new project: ${name}`);
  }, [addLog]);

  const handleProjectSelect = useCallback((project: Project) => {
    setSelectedProject(project);
    setSelectedImage(null);
    setSelectedROI(null);
    addLog('info', `Opened project: ${project.name}`);
  }, [addLog]);

  // Image management
  const handleImageSelect = useCallback(async (image: Image) => {
    setSelectedImage(image);
    setSelectedROI(null);
    addLog('info', `Selected image: ${image.name}`);
    
    // Load ROIs for the selected image
    try {
      const projectId = image.projectId ?? selectedProject?.id ?? DEFAULT_PROJECT_ID;
      const imageROIs = await fetchImageROIs(image.id, projectId);
      setROIs(prev => {
        // Remove existing ROIs for this image and add the new ones
        const otherROIs = prev.filter(roi => roi.imageId !== image.id || roi.projectId !== projectId);
        return [...otherROIs, ...imageROIs];
      });
    } catch (error) {
      console.error('Failed to load ROIs:', error);
      addLog('warning', 'Failed to load existing ROIs');
    }
  }, [addLog]);

  const handleAddImages = useCallback(async (files: FileList) => {
    if (!selectedProject) {
      addLog('warning', 'Please select a project first');
      return;
    }

    const newImages: Image[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (file.type.startsWith('image/')) {
          // Handle standard images
          const url = URL.createObjectURL(file);
          const newImage: Image = {
            id: crypto.randomUUID(),
            name: file.name,
            imageUrl: url,
            thumbnailUrl: url,
            sourceType: 'local',
            projectId: selectedProject.id
          };
          newImages.push(newImage);
        } else {
          // Handle biological formats via server upload
          addLog('info', `Uploading biological image: ${file.name}`);
          const uploadedImage = await uploadSlideToServer(file);
          const newImage: Image = {
            ...uploadedImage,
            projectId: selectedProject.id
          };
          newImages.push(newImage);
          addLog('success', `Successfully uploaded: ${file.name}`);
        }
      } catch (error) {
        addLog('error', `Failed to add image: ${file.name}`);
      }
    }

    if (newImages.length > 0) {
      setImages(prev => [...prev, ...newImages]);
      
      // Update project with new image IDs
      setProjects(prev => prev.map(p => 
        p.id === selectedProject.id 
          ? { ...p, imageIds: [...p.imageIds, ...newImages.map(img => img.id)] }
          : p
      ));

      setSelectedImage(newImages[0]);
      addLog('success', `Added ${newImages.length} images to project`);
    }
  }, [selectedProject, addLog]);

  // ROI management
  const handleROICreate = useCallback(async (roiData: Omit<ROI, 'id' | 'createdAt'>) => {
    try {
  const projectId = roiData.projectId ?? selectedProject?.id ?? DEFAULT_PROJECT_ID;
  const newROI = await createImageROI(roiData.imageId, roiData.name, roiData.geometry, projectId);
      setROIs(prev => [...prev, newROI]);
      setSelectedROI(newROI);
      addLog('success', `Created ROI: ${newROI.name}`);
    } catch (error) {
      console.error('Failed to create ROI:', error);
      addLog('error', 'Failed to create ROI');
    }
  }, [addLog]);

  const handleROISelect = useCallback((roi: ROI | null) => {
    setSelectedROI(roi);
  }, []);

  const handleROIUpdate = useCallback((roiId: string, updates: Partial<ROI>) => {
    setROIs(prev => prev.map(roi => 
      roi.id === roiId ? { ...roi, ...updates } : roi
    ));
    addLog('info', 'ROI updated');
  }, [addLog]);

  const handleROIDelete = useCallback((roiId: string) => {
    setROIs(prev => prev.filter(roi => roi.id !== roiId));
    if (selectedROI?.id === roiId) {
      setSelectedROI(null);
    }
    addLog('info', 'ROI deleted');
  }, [selectedROI, addLog]);

  // Analysis
  const handleAnalyzeROI = useCallback((roi: ROI, image: Image) => {
    const analysisPrompt = `Please analyze ROI "${roi.name}" on ${image.name}: x=${roi.geometry.x|0}, y=${roi.geometry.y|0}, w=${roi.geometry.w|0}, h=${roi.geometry.h|0}.
- Quantify CD68-positive cell density within the ROI.
- Summarize spatial immune infiltration patterns.`;
    
    void handleSendMessage(analysisPrompt);
    addLog('info', `Started analysis for ROI: ${roi.name}`);
  }, []);

  // Chat handling
  const handleSendMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { 
      id: crypto.randomUUID(), 
      role: 'user', 
      content: text, 
      ts: Date.now() 
    };
    setMessages(prev => [...prev, userMsg]);

    setLoading(true);
    try {
      const reply = await sendChat(text);
      const assistantMsg: ChatMessage = { 
        id: crypto.randomUUID(), 
        role: 'assistant', 
        content: reply, 
        ts: Date.now() 
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Check if this was an analysis request and add mock results
      if (text.toLowerCase().includes('analyze') || text.toLowerCase().includes('cell')) {
        addResult({
          type: 'cell_typing',
          roiId: selectedROI?.id,
          imageId: selectedImage?.id,
          data: {
            cell_counts: {
              lymphocytes: 4320,
              stromal_cells: 3150,
              epithelial_cells: 2980,
              endothelial_cells: 1370
            },
            percentages: {
              lymphocytes: 36.5,
              stromal_cells: 26.7,
              epithelial_cells: 25.2,
              endothelial_cells: 11.6
            }
          }
        });
        addLog('success', 'Cell typing analysis completed');
      }
    } catch (error) {
      console.error('Chat error:', error);
      const message =
        error instanceof Error ? error.message : 'Chat request failed';
      addLog('error', message);
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Warning: ${message}`,
        ts: Date.now()
      };
      setMessages(prev => [...prev, assistantMsg]);
    } finally {
      setLoading(false);
    }
  }, [selectedROI, selectedImage, addResult, addLog]);

  return (
    <div className="h-screen flex bg-gray-100 overflow-hidden">
      {/* Left Panel - Project and Image Management */}
      <div className="w-80 flex-shrink-0 hidden lg:block">
        <ProjectPanel
          projects={projects}
          images={images}
          selectedProject={selectedProject}
          selectedImage={selectedImage}
          onProjectSelect={handleProjectSelect}
          onImageSelect={handleImageSelect}
          onCreateProject={handleCreateProject}
          onAddImages={handleAddImages}
        />
      </div>

      {/* Center Panels - Image Viewer and Log/Results */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top - Image Viewer */}
        <div className="flex-1 min-h-0">
          <ImageViewerPanel
            selectedImage={selectedImage}
            rois={rois}
            selectedROI={selectedROI}
            onROICreate={handleROICreate}
            onROISelect={handleROISelect}
            onROIUpdate={handleROIUpdate}
            onROIDelete={handleROIDelete}
            onAnalyzeROI={handleAnalyzeROI}
          />
        </div>

        {/* Bottom - Log and Results */}
        <div className="h-64 flex-shrink-0 hidden md:block">
          <LogResultsPanel
            logs={logs}
            results={results}
          />
        </div>
      </div>

      {/* Right Panel - Chat */}
      <div className="w-80 flex-shrink-0 hidden xl:block">
        <ChatPanel
          messages={messages}
          loading={loading}
          onSend={handleSendMessage}
          agentName="Slide"
        />
      </div>
    </div>
  );
};
