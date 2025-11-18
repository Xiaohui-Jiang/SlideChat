import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, Image, ProjectRequirements } from '../types';

type UploadParams = {
  imageId: string;
  fileType: string;
  file: File;
  label?: string;
};

type DeleteFileParams = {
  imageId: string;
  fileType: string;
};

interface ProjectPanelProps {
  projects: Project[];
  images: Image[];
  selectedProject: Project | null;
  selectedImage: Image | null;
  requirements?: ProjectRequirements | null;
  onProjectSelect: (project: Project) => void;
  onImageSelect: (image: Image) => void;
  onCreateProject: (name: string, description?: string) => void;
  onUploadProjectFile: (params: UploadParams) => void | Promise<void>;
  onDeleteProjectFile: (params: DeleteFileParams) => void | Promise<void>;
  onDeleteImage: (image: Image) => void | Promise<void>;
  onDeleteProject: (project: Project) => void | Promise<void>;
  onAddImages?: (files: FileList) => void;
  className?: string;
}

const DEFAULT_REQUIRED_TYPES = ['image', 'cells', 'matrix'];
const DEFAULT_OPTIONAL_TYPES = ['gene_panel', 'protein_panel', 'alignment'];

const FILE_TYPE_LABELS: Record<string, string> = {
  image: 'Whole Slide Image',
  cells: 'Cells CSV',
  matrix: 'Cell Feature Matrix',
  gene_panel: 'Gene Panel',
  protein_panel: 'Protein Panel',
  alignment: 'Alignment CSV'
};

const FILE_ACCEPTS: Record<string, string> = {
  image: 'image/*,.svs,.tif,.tiff,.ome,.ome.tif,.ome.tiff,.ndpi,.vsi,.scn',
  cells: '.csv,.csv.gz',
  matrix: '.h5,.h5ad',
  gene_panel: '.json,.csv,.tsv',
  protein_panel: '.json,.csv,.tsv',
  alignment: '.csv,.tsv'
};

const FILE_HELP_TEXT: Record<string, string> = {
  image: 'High-resolution TIFF / SVS / OME-TIFF slide',
  cells: 'cells.csv exported from Xenium Explorer',
  matrix: 'cell_feature_matrix.h5 describing expression counts',
  gene_panel: 'gene_panel.json for expression annotations (optional)',
  protein_panel: 'protein_panel.json for protein markers (optional)',
  alignment: 'Image alignment CSV (3×3 affine matrix)'
};

const formatBytes = (size?: number) => {
  if (!size || Number.isNaN(size)) return '';
  const mb = size / 1024 / 1024;
  return `${mb.toFixed(2)} MB`;
};

const formatFileTypeLabel = (fileType: string) => {
  const label = FILE_TYPE_LABELS[fileType];
  if (label) return label;
  return fileType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export const ProjectPanel: React.FC<ProjectPanelProps> = ({
  projects,
  images,
  selectedProject,
  selectedImage,
  requirements,
  onProjectSelect,
  onImageSelect,
  onCreateProject,
  onUploadProjectFile,
  onDeleteProjectFile,
  onDeleteImage,
  onDeleteProject,
  onAddImages,
  className = ''
}) => {
  const [activeTab, setActiveTab] = useState<'projects' | 'images'>('projects');
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [firstFile, setFirstFile] = useState<File | null>(null);
  const [firstFileError, setFirstFileError] = useState<string | null>(null);

  const requiredFileTypes = useMemo(
    () => (requirements?.required?.length ? requirements.required : DEFAULT_REQUIRED_TYPES),
    [requirements]
  );

  const optionalFileTypes = useMemo(
    () => (requirements?.optional?.length ? requirements.optional : DEFAULT_OPTIONAL_TYPES),
    [requirements]
  );

  const orderedFileTypes = useMemo(
    () => Array.from(new Set([...requiredFileTypes, ...optionalFileTypes])),
    [requiredFileTypes, optionalFileTypes]
  );

  const [firstFileForm, setFirstFileForm] = useState({
    imageId: '',
    label: '',
    fileType: orderedFileTypes[0] ?? 'image'
  });

  useEffect(() => {
    setFirstFileForm((prev) => {
      if (!orderedFileTypes.length) {
        return prev;
      }
      return orderedFileTypes.includes(prev.fileType)
        ? prev
        : { ...prev, fileType: orderedFileTypes[0] };
    });
  }, [orderedFileTypes]);

  const projectImages = selectedProject
    ? images.filter((img) => img.projectId === selectedProject.id)
    : [];

  const firstFileInputId = React.useMemo(
    () => `first-file-input-${Math.random().toString(36).slice(2, 10)}`,
    []
  );
  
  const firstFileInputRef = React.useRef<HTMLInputElement>(null);

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      onCreateProject(newProjectName.trim(), newProjectDescription.trim() || undefined);
      setNewProjectName('');
      setNewProjectDescription('');
      setShowCreateProject(false);
    }
  };

  const handleAddImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && onAddImages) {
      onAddImages(e.target.files);
      e.target.value = '';
    }
  };

  const handleImageFileInput = useCallback(
    (imageId: string, fileType: string, label?: string | null) =>
      async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          await onUploadProjectFile({
            imageId,
            fileType,
            file,
            label: label || undefined
          });
        } catch (error) {
          console.error('Failed to upload file', error);
        } finally {
          event.target.value = '';
        }
      },
    [onUploadProjectFile]
  );

  const handleFirstFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setFirstFile(file);
    setFirstFileError(null);
  };

  const handleFirstFileSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    if (!selectedProject) {
      console.error('❌ ProjectPanel: No project selected');
      setFirstFileError('Please select a project first.');
      return;
    }
    if (!firstFileForm.imageId.trim()) {
      console.error('❌ ProjectPanel: No image ID provided');
      setFirstFileError('Image ID is required.');
      return;
    }
    if (!firstFile) {
      console.error('❌ ProjectPanel: No file selected');
      setFirstFileError('Please choose a file to upload.');
      return;
    }

    try {
      await onUploadProjectFile({
        imageId: firstFileForm.imageId.trim(),
        fileType: firstFileForm.fileType,
        file: firstFile,
        label: firstFileForm.label.trim() || undefined
      });

      setFirstFile(null);
      setFirstFileError(null);
      setFirstFileForm((prev) => ({ ...prev, imageId: '', label: '' }));
    } catch (error) {
      console.error('❌ ProjectPanel: Upload failed:', error);
      setFirstFileError(error instanceof Error ? error.message : 'Upload failed. Please try again.');
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
                  <>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete project "${selectedProject.name}"? This will delete all images and files. This cannot be undone.`)) {
                          onDeleteProject(selectedProject);
                        }
                      }}
                      className="px-3 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                      title="Delete project"
                    >
                      🗑️ Delete
                    </button>
                    <button
                      onClick={() => {
                        onProjectSelect(selectedProject);
                        setActiveTab('images');
                      }}
                      className="px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                    >
                      Open Project
                    </button>
                  </>
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
            <div className="p-3 border-b bg-gray-50">
              {selectedProject ? (
                <>
                  <div className="text-xs font-medium text-gray-700 mb-2">
                    Project: {selectedProject.name}
                  </div>
                    {onAddImages && (
                      <>
                        <input
                          id="project-images-input"
                          name="projectImages"
                          type="file"
                          multiple
                          accept="image/*,.svs,.tif,.tiff,.ome.tiff,.ndpi,.vsi,.scn"
                          onChange={handleAddImages}
                          className="sr-only"
                        />
                        <label
                          htmlFor="project-images-input"
                          className="inline-flex items-center px-3 py-1.5 text-sm bg-green-500 text-white rounded cursor-pointer hover:bg-green-600"
                        >
                          📤 Upload Base Images
                        </label>
                      </>
                    )}
                    <div className="mt-2 text-xs text-gray-600 space-y-1">
                      <div>
                        <span className="font-semibold text-gray-700">Required files:</span>{' '}
                        {requiredFileTypes.map((type) => formatFileTypeLabel(type)).join(', ')}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-700">Optional files:</span>{' '}
                        {optionalFileTypes.length > 0
                          ? optionalFileTypes.map((type) => formatFileTypeLabel(type)).join(', ')
                          : 'None'}
                      </div>
                    </div>
                </>
              ) : (
                <div className="text-sm text-gray-500 text-center py-4">
                  Please select or create a project first to upload images
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {!selectedProject ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="text-4xl mb-3">📁</div>
                  <div className="text-sm font-medium text-gray-700 mb-1">No Project Selected</div>
                  <div className="text-xs text-gray-500">
                    Select a project from the Projects tab to view and manage images
                  </div>
                </div>
              ) : projectImages.length === 0 ? (
                <div className="max-w-md mx-auto bg-white border rounded-lg shadow-sm p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3">
                    <span className="text-lg">🧾</span> Upload the first file for this project
                  </div>
                  <p className="text-xs text-gray-500 mb-4">
                    Start by creating an image entry and attaching its first required file (usually the TIFF slide).
                    You can upload the remaining files once the image appears in the list.
                  </p>
                  <form className="space-y-3" onSubmit={handleFirstFileSubmit}>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Image ID</label>
                      <input
                        type="text"
                        value={firstFileForm.imageId}
                        onChange={(e) => setFirstFileForm((prev) => ({ ...prev, imageId: e.target.value }))}
                        placeholder="e.g. kidney_demo"
                        className="w-full px-2 py-1.5 text-sm border rounded"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Display Label (optional)</label>
                      <input
                        type="text"
                        value={firstFileForm.label}
                        onChange={(e) => setFirstFileForm((prev) => ({ ...prev, label: e.target.value }))}
                        placeholder="Human Kidney H&E"
                        className="w-full px-2 py-1.5 text-sm border rounded"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-700">File Type</label>
                      <select
                        className="w-full px-2 py-1.5 text-sm border rounded"
                        value={firstFileForm.fileType}
                        onChange={(e) => setFirstFileForm((prev) => ({ ...prev, fileType: e.target.value }))}
                      >
                        {orderedFileTypes.map((fileType) => (
                          <option value={fileType} key={fileType}>
                            {formatFileTypeLabel(fileType)}
                            {requiredFileTypes.includes(fileType) ? ' (required)' : ' (optional)'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Select File</label>
                      <label
                        htmlFor={firstFileInputId}
                        className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg px-3 py-6 text-sm text-gray-600 cursor-pointer hover:border-blue-400"
                      >
                        {firstFile ? (
                          <>
                            <span className="text-sm font-semibold text-blue-600">{firstFile.name}</span>
                            <span className="text-xs text-gray-500 mt-1">{formatBytes(firstFile.size)}</span>
                            <span className="text-[11px] text-gray-500 mt-1">Click to replace file</span>
                          </>
                        ) : (
                          <>
                            <span className="text-lg mb-1">📎</span>
                            <span>Select {formatFileTypeLabel(firstFileForm.fileType)}</span>
                            <span className="text-[11px] text-gray-500 mt-1">{FILE_HELP_TEXT[firstFileForm.fileType] || 'Choose a file from your computer'}</span>
                          </>
                        )}
                      </label>
                      <input
                        ref={firstFileInputRef}
                        id={firstFileInputId}
                        type="file"
                        accept={FILE_ACCEPTS[firstFileForm.fileType]}
                        onChange={handleFirstFileInput}
                        style={{ 
                          opacity: 0,
                          position: 'absolute',
                          width: '0.1px',
                          height: '0.1px',
                          zIndex: -1
                        }}
                      />
                    </div>
                    {firstFileError && (
                      <div className="text-xs text-red-600">{firstFileError}</div>
                    )}
                    <button
                      type="submit"
                      className="w-full py-2 text-sm font-semibold bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Upload & Create Image Entry
                    </button>
                  </form>
                </div>
              ) : (
              <div className="space-y-3">
                {projectImages.map((image) => (
                  <div
                    key={image.id}
                    className={`border rounded-lg overflow-hidden ${
                      selectedImage?.id === image.id
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div
                      onClick={() => onImageSelect(image)}
                      className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                        selectedImage?.id === image.id ? '' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="relative">
                        {image.thumbnailUrl ? (
                          <img
                            src={image.thumbnailUrl}
                            alt={image.name}
                            className="w-12 h-12 object-cover rounded"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center text-xl">
                            {getFormatIcon(image.format)}
                          </div>
                        )}
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
                        {image.status && (
                          <div className="mt-1">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              image.status.ready 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {image.status.ready ? '✓ Ready' : `Missing: ${image.status.missing?.join(', ')}`}
                            </span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete image "${image.label || image.name}"? This will delete all associated files.`)) {
                            onDeleteImage(image);
                          }
                        }}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-colors"
                        title="Delete image"
                      >
                        🗑️
                      </button>
                    </div>

                    {/* Upload grid */}
                    <div className="border-t border-gray-200 bg-white p-3">
                      <div className="text-xs font-semibold text-gray-700 mb-2">Upload or replace supportive files</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {orderedFileTypes.map((fileType) => {
                          const inputId = `${image.id}-${fileType}-file-input`;
                          const hasFile = Boolean(image.files?.[fileType]);
                          const required = requiredFileTypes.includes(fileType);
                          const badge = hasFile ? 'Uploaded' : required ? 'Required' : 'Optional';
                          const palette = hasFile
                            ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                            : required
                              ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                              : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100';

                          return (
                            <div key={`${image.id}-${fileType}`}>
                              <input
                                id={inputId}
                                type="file"
                                accept={FILE_ACCEPTS[fileType]}
                                onChange={handleImageFileInput(image.id, fileType, image.label)}
                                className="sr-only"
                              />
                              <label
                                htmlFor={inputId}
                                className={`flex flex-col gap-1 p-2 border rounded cursor-pointer transition-colors text-xs ${palette}`}
                              >
                              <div className="flex items-center justify-between font-semibold">
                                <span>{formatFileTypeLabel(fileType)}</span>
                                <span className="px-1.5 py-0.5 rounded bg-white border border-current text-[10px] uppercase tracking-wide">
                                  {badge}
                                </span>
                              </div>
                              {FILE_HELP_TEXT[fileType] && (
                                <div className="text-[11px] text-gray-600 leading-snug">
                                  {FILE_HELP_TEXT[fileType]}
                                </div>
                              )}
                              <div className="text-[11px] text-gray-500">
                                {hasFile ? 'Click to replace file' : 'Click to upload file'}
                              </div>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Uploaded Files List */}
                    {image.files && Object.keys(image.files).length > 0 && (
                      <div className="border-t border-gray-200 bg-gray-50 p-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2">Uploaded Files:</div>
                        <div className="space-y-1.5">
                          {Object.entries(image.files).map(([fileType, fileMetadata]) => (
                            <div
                              key={fileType}
                              className="flex items-center justify-between bg-white rounded px-2 py-1.5 text-xs"
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="font-medium text-blue-600">{fileType}:</span>
                                <span className="text-gray-700 truncate font-mono text-[11px]">
                                  {fileMetadata.originalName}
                                </span>
                                {fileMetadata.size && (
                                  <span className="text-gray-400 text-[10px] whitespace-nowrap">
                                    ({formatBytes(fileMetadata.size)})
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const confirmed = window.confirm(
                                    `Delete ${fileType} file (${fileMetadata.originalName})?\n\nThis cannot be undone.`
                                  );
                                  if (confirmed) {
                                    onDeleteProjectFile({ imageId: image.id, fileType });
                                  }
                                }}
                                className="ml-2 px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors flex-shrink-0"
                                title={`Delete ${fileType} file`}
                              >
                                🗑️
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
