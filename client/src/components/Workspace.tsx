import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  ProjectRequirements
} from '../types';
import {
  fetchProjects,
  fetchProjectRequirements,
  createProjectOnServer,
  uploadProjectFile,
  deleteProjectFile,
  deleteProjectImage,
  fetchImageROIs,
  fetchProjectImage,
  createImageROI,
  deleteProjectOnServer,
  sendChat
} from '../lib/api';

export const Workspace: React.FC = () => {
  // Core state
  const [projects, setProjects] = useState<Project[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [rois, setROIs] = useState<ROI[]>([]);
  const [requirements, setRequirements] = useState<ProjectRequirements | null>(null);
  
  // Selection state
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedImage, setSelectedImage] = useState<Image | null>(null);
  const [selectedROI, setSelectedROI] = useState<ROI | null>(null);
  const selectedProjectRef = useRef<Project | null>(null);

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

  // Image management (defined early for dependency ordering)
  const handleImageSelect = useCallback(async (image: Image | null, projectOverride?: Project | null) => {
    if (!image) {
      setSelectedImage(null);
      setROIs([]);
      return;
    }

    setSelectedImage(image);
    setSelectedROI(null);
    addLog('info', `Selected image: ${image.name}`);

    const contextProject = projectOverride ?? selectedProjectRef.current;
    const projectId = contextProject?.id ?? image.projectId;
    if (!projectId) {
      addLog('warning', 'Unable to determine project for selected image');
      setROIs([]);
      return;
    }

    try {
      // console.log('🔍 Workspace: Fetching ROIs for image:', image.id, 'project:', projectId);
      const imageROIs = await fetchImageROIs(image.id, projectId);
      // console.log('📦 Workspace: Fetched ROIs:', imageROIs.length, imageROIs);
      setROIs(imageROIs);
    } catch (error) {
      // console.error('❌ Workspace: Failed to load ROIs:', error);
      addLog('warning', 'Failed to load existing ROIs');
      setROIs([]);
    }
  }, [addLog]);

  // Project management
  const handleCreateProject = useCallback(async (name: string, description?: string) => {
    try {
      const project = await createProjectOnServer(name, description);
      setProjects(prev => [...prev, project]);
      addLog('info', `Created new project: ${project.name}`);
  await handleProjectSelect(project);
    } catch (error) {
      console.error('Failed to create project:', error);
      addLog('error', 'Failed to create project');
    }
  }, [addLog]);

  const handleProjectSelect = useCallback(async (
    project: Project,
    options?: { skipLog?: boolean; focusImageId?: string; skipProjectStateUpdate?: boolean }
  ) => {
    selectedProjectRef.current = project;
    if (!options?.skipProjectStateUpdate) {
      setSelectedProject(project);
    }
    setSelectedImage(null);
    setSelectedROI(null);
    if (!options?.skipLog) {
      addLog('info', `Opened project: ${project.name}`);
    }

    try {
      setLoading(true);
      const { requirements: reqs, images: serverImages } = await fetchProjectRequirements(project.id);
      setRequirements(reqs);
      setImages(serverImages);
      setProjects(prev =>
        prev.map(p =>
          p.id === project.id
            ? { ...p, imageIds: serverImages.map((img: Image) => img.id) }
            : p
        )
      );

      if (serverImages.length > 0) {
        const focusImage = options?.focusImageId
          ? serverImages.find((img: Image) => img.id === options.focusImageId) ?? serverImages[0]
          : serverImages[0];
        await handleImageSelect(focusImage, project);
      } else {
        setSelectedImage(null);
        setROIs([]);
      }
    } catch (error) {
      console.error('Failed to load project details:', error);
      addLog('error', 'Failed to load project details');
    } finally {
      setLoading(false);
    }
  }, [addLog, handleImageSelect]);

  const loadProjects = useCallback(async () => {
    try {
      const serverProjects = await fetchProjects();
      setProjects(serverProjects);

      if (serverProjects.length === 0) {
        addLog('info', 'No projects available yet. Create one to get started.');
        setSelectedProject(null);
        setImages([]);
        setROIs([]);
        return;
      }

      const firstProject = serverProjects[0];
      await handleProjectSelect(firstProject, { skipLog: true });
    } catch (error) {
      console.error('Failed to load projects:', error);
      addLog('error', 'Failed to load projects from server');
    }
  }, [addLog, handleProjectSelect]);

  // Initialize with server data
  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  useEffect(() => {
    if (
      !selectedProject ||
      !selectedImage?.id ||
      !selectedImage?.status?.ready ||
      selectedImage.status?.processed
    ) {
      return;
    }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const pollImageStatus = async () => {
      try {
        const freshImage = await fetchProjectImage(selectedProject.id, selectedImage.id);
        if (cancelled) {
          return;
        }

        setImages((prev) => {
          const index = prev.findIndex((img) => img.id === freshImage.id);
          if (index === -1) {
            return prev;
          }
          const next = [...prev];
          next[index] = freshImage;
          return next;
        });

        setSelectedImage((prev) => (prev && prev.id === freshImage.id ? freshImage : prev));

        if (freshImage.status?.processed && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to refresh image status:', error);
        }
      }
    };

    pollImageStatus();
    intervalId = setInterval(pollImageStatus, 5000);

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [selectedProject?.id, selectedImage?.id, selectedImage?.status?.ready, selectedImage?.status?.processed, fetchProjectImage]);

  const handleProjectFileUpload = useCallback(async (
    params: { imageId: string; fileType: string; file: File; label?: string }
  ) => {
    if (!selectedProject) {
      console.error('❌ Workspace: No project selected');
      addLog('warning', 'Please select a project first');
      return;
    }

    try {
      addLog('info', `Uploading ${params.fileType} for image ${params.imageId}`);
      
      const result = await uploadProjectFile({
        projectId: selectedProject.id,
        imageId: params.imageId,
        fileType: params.fileType,
        file: params.file,
        label: params.label
      });
      
      addLog('success', `Uploaded ${params.fileType} file`);
      
      await handleProjectSelect(selectedProject, {
        skipLog: true,
        focusImageId: params.imageId
      });
    } catch (error) {
      console.error('❌ Workspace: File upload failed:', error);
      addLog('error', 'File upload failed');
    }
  }, [selectedProject, addLog, handleProjectSelect]);

  const handleProjectFileDelete = useCallback(async (
    params: { imageId: string; fileType: string }
  ) => {
    if (!selectedProject) {
      addLog('warning', 'Please select a project first');
      return;
    }

    const confirmed = window.confirm(
      `Delete ${params.fileType} file? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      addLog('info', `Deleting ${params.fileType} for image ${params.imageId}`);
      await deleteProjectFile({
        projectId: selectedProject.id,
        imageId: params.imageId,
        fileType: params.fileType
      });
      addLog('success', `Deleted ${params.fileType} file`);
      await handleProjectSelect(selectedProject, {
        skipLog: true,
        focusImageId: params.imageId
      });
    } catch (error) {
      console.error('File deletion failed:', error);
      addLog('error', 'File deletion failed');
    }
  }, [selectedProject, addLog, handleProjectSelect]);

  const handleImageDelete = useCallback(async (image: Image) => {
    if (!selectedProject) {
      addLog('warning', 'Please select a project first');
      return;
    }

    const confirmed = window.confirm(
      `Delete image "${image.label || image.id}" and all its files? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      addLog('info', `Deleting image: ${image.label || image.id}`);
      await deleteProjectImage({
        projectId: selectedProject.id,
        imageId: image.id
      });
      addLog('success', `Deleted image: ${image.label || image.id}`);

      // Update state
      setImages((prev) => prev.filter((img) => img.id !== image.id));
      
      // If the deleted image was selected, clear selection
      if (selectedImage?.id === image.id) {
        setSelectedImage(null);
        setSelectedROI(null);
        setROIs([]);
      }

      // Reload project to update state
      await handleProjectSelect(selectedProject, {
        skipLog: true
      });
    } catch (error) {
      console.error('Image deletion failed:', error);
      addLog('error', 'Image deletion failed');
    }
  }, [selectedProject, selectedImage, addLog, handleProjectSelect]);

  const handleProjectDelete = useCallback(async (project: Project) => {
    try {
      addLog('info', `Deleting project: ${project.name}`);
      await deleteProjectOnServer(project.id);
      addLog('success', `Deleted project: ${project.name}`);

      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      setImages((prev) => prev.filter((img) => img.projectId !== project.id));

      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
        selectedProjectRef.current = null;
        setSelectedImage(null);
        setSelectedROI(null);
        setROIs([]);
        setRequirements(null);
      }

      await loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
      addLog('error', 'Failed to delete project');
      throw error;
    }
  }, [addLog, deleteProjectOnServer, loadProjects, selectedProject]);

  // ROI management
  const handleROICreate = useCallback(async (roiData: Omit<ROI, 'id' | 'createdAt'>) => {
    try {
      const projectId = roiData.projectId ?? selectedProject?.id;
      if (!projectId) {
        addLog('warning', 'Select a project before creating ROIs');
        return;
      }
      const newROI = await createImageROI(roiData.imageId, roiData.name, roiData.geometry, projectId);
      setROIs(prev => [...prev, newROI]);
      setSelectedROI(newROI);
      addLog('success', `Created ROI: ${newROI.name}`);
    } catch (error) {
      console.error('Failed to create ROI:', error);
      addLog('error', 'Failed to create ROI');
    }
  }, [addLog, selectedProject]);

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

  const handleRefreshSlideStatus = useCallback(async (slideId: string) => {
    if (!selectedProject?.id) {
      addLog('warning', 'Select a project before refreshing slide status');
      return;
    }

    try {
      const freshImage = await fetchProjectImage(selectedProject.id, slideId);
      setImages((prev) => prev.map(img => (img.id === freshImage.id ? freshImage : img)));
      setSelectedImage((prev) => (prev && prev.id === freshImage.id ? freshImage : prev));
      addLog('info', `Refreshed slide status for ${freshImage.label || freshImage.id}`);
    } catch (error) {
      console.error('Failed to refresh slide status:', error);
      addLog('warning', 'Unable to refresh slide status right now');
    }
  }, [selectedProject, addLog]);

  return (
    <div className="h-screen flex bg-gray-100 overflow-hidden">
      {/* Left Panel - Project and Image Management */}
      <div className="w-80 flex-shrink-0 hidden lg:block">
        <ProjectPanel
          projects={projects}
          images={images}
          selectedProject={selectedProject}
          selectedImage={selectedImage}
          requirements={requirements}
          onProjectSelect={(project) => void handleProjectSelect(project)}
          onImageSelect={(image) => void handleImageSelect(image)}
          onCreateProject={(name, description) => void handleCreateProject(name, description)}
          onUploadProjectFile={(params) => handleProjectFileUpload(params)}
          onDeleteProjectFile={(params) => handleProjectFileDelete(params)}
          onDeleteImage={(image) => handleImageDelete(image)}
          onDeleteProject={(project) => handleProjectDelete(project)}
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
            onRefreshSlide={handleRefreshSlideStatus}
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
