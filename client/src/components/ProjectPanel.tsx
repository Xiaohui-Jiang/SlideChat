import React, { useState } from 'react';
import type { Project, Image } from '../types';

interface ProjectPanelProps {
  projects: Project[];
  images: Image[];
  selectedProject: Project | null;
  selectedImage: Image | null;
  onProjectSelect: (project: Project) => void;
  onImageSelect: (image: Image) => void;
  onCreateProject: (name: string, description?: string) => void;
  onAddImages: (files: FileList) => void;
  className?: string;
}

export const ProjectPanel: React.FC<ProjectPanelProps> = ({
  projects,
  images,
  selectedProject,
  selectedImage,
  onProjectSelect,
  onImageSelect,
  onCreateProject,
  onAddImages,
  className = ''
}) => {
  const [activeTab, setActiveTab] = useState<'projects' | 'images'>('projects');
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');

  const projectImages = selectedProject 
    ? images.filter(img => selectedProject.imageIds.includes(img.id))
    : [];

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      onCreateProject(newProjectName.trim(), newProjectDescription.trim() || undefined);
      setNewProjectName('');
      setNewProjectDescription('');
      setShowCreateProject(false);
    }
  };

  const handleAddImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onAddImages(e.target.files);
      e.target.value = '';
    }
  };

  const getFormatIcon = (format?: string) => {
    switch (format) {
      case '.svs': return '🔬';
      case '.tif':
      case '.tiff':
      case '.ome.tiff': return '🧬';
       case '.ndpi': return '🏥';
       case '.vsi': return '🔍';
       case '.scn': return '📊';
       default: return '🖼️';
    }
  };

  return (
    <div className={`flex flex-col h-full bg-white border-r ${className}`}>
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('projects')}
          className={`flex-1 px-4 py-2 text-sm font-medium ${
            activeTab === 'projects' 
              ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700' 
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Projects
        </button>
        <button
          onClick={() => setActiveTab('images')}
          className={`flex-1 px-4 py-2 text-sm font-medium ${
            activeTab === 'images' 
              ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700' 
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Images
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'projects' && (
          <div className="h-full flex flex-col">
            <div className="p-3 border-b">
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Create Project
                </button>
                {selectedProject && (
                  <button
                    onClick={() => onProjectSelect(selectedProject)}
                    className="px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                  >
                    Open Project
                  </button>
                )}
              </div>
            </div>

            {showCreateProject && (
              <div className="p-3 border-b bg-gray-50">
                <div className="space-y-2">
                  <input
                    id="project-name-input"
                    name="projectName"
                    type="text"
                    placeholder="Project name"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    className="w-full px-2 py-1 text-sm border rounded"
                  />
                  <input
                    id="project-description-input"
                    name="projectDescription"
                    type="text"
                    placeholder="Description (optional)"
                    value={newProjectDescription}
                    onChange={(e) => setNewProjectDescription(e.target.value)}
                    className="w-full px-2 py-1 text-sm border rounded"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateProject}
                      className="px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => setShowCreateProject(false)}
                      className="px-2 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-2">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => onProjectSelect(project)}
                    className={`p-3 border rounded cursor-pointer transition-colors ${
                      selectedProject?.id === project.id
                        ? 'bg-blue-50 border-blue-300'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium text-sm">{project.name}</div>
                    {project.description && (
                      <div className="text-xs text-gray-600 mt-1">{project.description}</div>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                      {project.imageIds.length} images
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'images' && (
          <div className="h-full flex flex-col">
            <div className="p-3 border-b">
              <label className="inline-flex items-center px-3 py-1.5 text-sm bg-green-500 text-white rounded cursor-pointer hover:bg-green-600">
                Add Biological Images
                <input
                  id="project-images-input"
                  name="projectImages"
                  type="file"
                  multiple
                  accept="image/*,.svs,.tif,.tiff,.ome.tiff,.ndpi,.vsi,.scn"
                  onChange={handleAddImages}
                  className="hidden"
                />
              </label>
              <div className="text-xs text-gray-500 mt-1">
                Supports: SVS, TIF, OME-TIFF, NDPI, VSI, SCN, JPG, PNG
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-2">
                {projectImages.map((image) => (
                  <div
                    key={image.id}
                    onClick={() => onImageSelect(image)}
                    className={`flex items-center gap-3 p-2 border rounded cursor-pointer transition-colors ${
                      selectedImage?.id === image.id
                        ? 'bg-blue-50 border-blue-300'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="relative">
                      <img
                        src={image.thumbnailUrl}
                        alt={image.name}
                        className="w-12 h-12 object-cover rounded"
                      />
                      <div className="absolute -top-1 -right-1 text-lg">
                        {getFormatIcon(image.format)}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{image.name}</div>
                      <div className="text-xs text-gray-500">
                        {image.format ? `${image.format.toUpperCase()} • ` : ''}{image.sourceType || 'unknown'}
                      </div>
                      {image.metadata?.tissueType && (
                        <div className="text-xs text-blue-600">
                          {image.metadata.tissueType} • {image.metadata.staining || 'Unknown staining'}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
