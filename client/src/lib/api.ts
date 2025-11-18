import type {
  Slide,
  ROI,
  Rect,
  Project,
  Image,
  ProjectRequirements,
  ProjectFileMetadata,
  ProjectImageStatus,
  ImagePipelineState
} from '../types';

const API = '/api';
export const DEFAULT_PROJECT_ID = 'default-project';

const resolveProjectId = (projectId?: string) => projectId ?? DEFAULT_PROJECT_ID;

const projectImageROIsEndpoint = (projectId: string, imageId: string) =>
  `${API}/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}/rois`;

const projectImageROIEndpoint = (projectId: string, imageId: string, roiId: string) =>
  `${projectImageROIsEndpoint(projectId, imageId)}/${encodeURIComponent(roiId)}`;

interface ServerProjectImage {
  id: string;
  label?: string;
  files?: Record<string, ProjectFileMetadata>;
  status?: ProjectImageStatus;
  processed?: Record<string, unknown> | null;
  pipeline?: ImagePipelineState;
  dziManifestUrl?: string | null;
  dziTileBaseUrl?: string | null;
  assetVersion?: number | null;
}

interface ServerProject {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt?: number;
  images?: Record<string, ServerProjectImage>;
}

interface ProjectRequirementsResponse {
  required: string[];
  optional: string[];
  images: ServerProjectImage[];
}

type UploadPayload = {
  projectId: string;
  imageId: string;
  fileType: string;
  file: File;
  label?: string;
};

async function safeFetch<T>(
  input: RequestInfo,
  init?: RequestInit,
  mock?: () => T
): Promise<T> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status}`);
      // Attach response for debugging
      (error as any).status = res.status;
      throw error;
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    if (mock) {
      return mock();
    }
    throw error;
  }
}

const extractExtension = (filename: string | undefined) => {
  if (!filename) return undefined;
  const match = filename.match(/(\.[^./\\]+)$/);
  return match ? match[1].toLowerCase() : undefined;
};

const projectImageBaseUrl = (projectId: string, imageId: string) =>
  `${API}/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}`;

const mapServerImageToClient = (projectId: string, image: ServerProjectImage): Image => {
  const imageFile = image.files?.image;
  const baseUrl = projectImageBaseUrl(projectId, image.id);
  const assetVersion = image.assetVersion ?? image.status?.processedAt ?? imageFile?.uploadedAt ?? null;
  const cacheSuffix = assetVersion ? `?v=${assetVersion}` : '';
  const dziManifestUrl =
    image.dziManifestUrl ?? (imageFile ? `${baseUrl}/dzi/manifest.dzi${cacheSuffix}` : null);
  const dziTileBaseUrl = image.dziTileBaseUrl ?? (imageFile ? `${baseUrl}/dzi` : null);

  return {
    id: image.id,
    name: image.label || image.id,
    label: image.label || image.id,
    dziManifestUrl,
    dziTileBaseUrl,
  assetVersion,
    sourceType: 'uploaded',
    projectId,
    format: extractExtension(imageFile?.originalName),
    files: image.files,
    status: image.status,
    processed: image.processed ?? null,
    pipeline: image.pipeline,
    metadata: imageFile
      ? {
          fileSize: imageFile.size,
          fileFormat: extractExtension(imageFile.originalName)?.replace('.', '').toUpperCase()
        }
      : undefined
  };
};

const mapServerProjectToClient = (project: ServerProject): Project => ({
  id: project.id,
  name: project.name,
  description: project.description,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  imageIds: Object.keys(project.images ?? {})
});

export async function fetchProjects(): Promise<Project[]> {
  const projects = await safeFetch<ServerProject[]>(`${API}/projects`, { method: 'GET' }, () => []);
  return projects.map(mapServerProjectToClient);
}

export async function createProjectOnServer(name: string, description?: string): Promise<Project> {
  const body = JSON.stringify({ name, description });
  const project = await safeFetch<ServerProject>(
    `${API}/projects`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    },
    undefined
  );
  return mapServerProjectToClient(project);
}

export async function deleteProjectOnServer(projectId: string): Promise<void> {
  await safeFetch<null>(
    `${API}/projects/${encodeURIComponent(projectId)}`,
    { method: 'DELETE' }
  );
}

export async function fetchProjectRequirements(projectId: string): Promise<{
  requirements: ProjectRequirements;
  images: Image[];
}> {
  const { required, optional, images } = await safeFetch<ProjectRequirementsResponse>(
    `${API}/projects/${encodeURIComponent(projectId)}/requirements`,
    { method: 'GET' }
  );

  return {
    requirements: { required, optional },
    images: (images || []).map((img) => mapServerImageToClient(projectId, img))
  };
}

export async function fetchProjectImages(projectId: string): Promise<Image[]> {
  const images = await safeFetch<ServerProjectImage[]>(
    `${API}/projects/${encodeURIComponent(projectId)}/images`,
    { method: 'GET' },
    () => []
  );
  return images.map((img) => mapServerImageToClient(projectId, img));
}

export async function fetchProjectImage(projectId: string, imageId: string): Promise<Image> {
  const image = await safeFetch<ServerProjectImage>(
    `${API}/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}`,
    { method: 'GET' }
  );
  return mapServerImageToClient(projectId, image);
}

export async function uploadProjectFile({
  projectId,
  imageId,
  fileType,
  file,
  label
}: UploadPayload) {
  console.log('📤 Client: Uploading file:', { projectId, imageId, fileType, fileName: file.name, fileSize: file.size });
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('fileType', fileType);
  if (label) {
    formData.append('label', label);
  }

  try {
    const result = await safeFetch(
      `${API}/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}/files`,
      {
        method: 'POST',
        body: formData
      }
    );
    console.log('✅ Client: Upload successful:', result);
    return result;
  } catch (error) {
    console.error('❌ Client: Upload failed:', error);
    throw error;
  }
}

export async function deleteProjectFile({
  projectId,
  imageId,
  fileType
}: {
  projectId: string;
  imageId: string;
  fileType: string;
}) {
  return safeFetch(
    `${API}/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}/files/${encodeURIComponent(fileType)}`,
    {
      method: 'DELETE'
    }
  );
}

export async function deleteProjectImage({
  projectId,
  imageId
}: {
  projectId: string;
  imageId: string;
}): Promise<void> {
  await safeFetch(
    `${API}/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}`,
    {
      method: 'DELETE'
    }
  );
}

interface ChatResponse {
  conversationId: string;
  reply: string;
  source: string;
  functions_used?: string[];
  summary?: string | null;
  error?: string;
}

// Store conversation state
let currentConversationId: string | null = null;

export async function sendChat(message: string): Promise<string> {
  console.log('🌐 API: Sending chat request to server:', message);
  try {
    const requestBody = {
      message,
      ...(currentConversationId && { conversationId: currentConversationId }),
      userId: 'user',
      metadata: { timestamp: Date.now() }
    };

    const result = await safeFetch<ChatResponse>(
      `${API}/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      () => {
        console.log('⚠️ API: Using fallback mock response');
        return {
          conversationId: 'mock-conversation',
          reply: `Mock reply: I received "${message}".`,
          source: 'fallback'
        };
      }
    );

    // Store conversation ID for subsequent requests
    if (result.conversationId) {
      currentConversationId = result.conversationId;
    }

    console.log('🌐 API: Got response from server:', result);
    return result.reply;
  } catch (error) {
    console.error('🚨 API ERROR in sendChat:', error);
    throw error;
  }
}

/**
 * Upload a file to the backend.
 * Server should return: { id, name, imageUrl, thumbnailUrl }
 */
export async function uploadSlideToServer(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API}/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return (await res.json()) as Slide;
}

// ROI API functions
export async function fetchROIs(slideId: string, projectId?: string): Promise<ROI[]> {
  const pid = resolveProjectId(projectId);
  try {
    return await safeFetch<ROI[]>(
      projectImageROIsEndpoint(pid, slideId),
      { method: 'GET' },
      () => []
    );
  } catch (error) {
    const status = (error as any)?.status;
    if (status === 404) {
      console.warn(`ROI data not found for image ${slideId} (project ${pid}); returning empty list.`);
      return [];
    }
    if (status === 409) {
      console.warn(`ROI data unavailable (processing required) for image ${slideId} (project ${pid}); returning empty list.`);
      return [];
    }
    throw error;
  }
}

export async function createROI(slideId: string, name: string, geometry: Rect, projectId?: string): Promise<ROI> {
  const pid = resolveProjectId(projectId);
  const res = await fetch(projectImageROIsEndpoint(pid, slideId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, geometry })
  });
  if (!res.ok) throw new Error(`Create ROI failed: ${res.status}`);
  return (await res.json()) as ROI;
}

export async function updateROIName(slideId: string, roiId: string, name: string, projectId?: string): Promise<ROI> {
  const pid = resolveProjectId(projectId);
  const res = await fetch(projectImageROIEndpoint(pid, slideId, roiId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(`Update ROI failed: ${res.status}`);
  return (await res.json()) as ROI;
}

export async function deleteROI(slideId: string, roiId: string, projectId?: string): Promise<void> {
  const pid = resolveProjectId(projectId);
  const res = await fetch(projectImageROIEndpoint(pid, slideId, roiId), {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error(`Delete ROI failed: ${res.status}`);
}

// Image-based ROI API functions (new structure)
export async function fetchImageROIs(imageId: string, projectId?: string): Promise<ROI[]> {
  return fetchROIs(imageId, projectId);
}

export async function createImageROI(imageId: string, name: string, geometry: Rect, projectId?: string): Promise<ROI> {
  return createROI(imageId, name, geometry, projectId);
}

export async function deleteImageROI(imageId: string, roiId: string, projectId?: string): Promise<void> {
  return deleteROI(imageId, roiId, projectId);
}

// Biological image specific API functions
export async function getImageMetadata(imageId: string) {
  return safeFetch(
    `${API}/images/${imageId}/metadata`,
    { method: 'GET' },
    () => ({})
  );
}

export async function getProcessingStatus(imageId: string) {
  return safeFetch(
    `${API}/images/${imageId}/processing-status`,
    { method: 'GET' },
    () => ({ status: 'unknown', progress: 0 })
  );
}

export async function getSupportedFormats() {
  return safeFetch(
    `${API}/supported-formats`,
    { method: 'GET' },
    () => ({
      biologicalFormats: [],
      standardFormats: []
    })
  );
}

// Simple chat API for general conversation
export async function simpleChat(
  message: string, 
  sessionId?: string,
  currentJobInfo?: { jobId: string; jobName: string }
): Promise<string> {
  try {
    const body: any = {
      message,
      session_id: sessionId || 'default'
    };
    
    // Include current job info if available
    if (currentJobInfo) {
      body.current_job = {
        job_id: currentJobInfo.jobId,
        job_name: currentJobInfo.jobName
      };
    }
    
    const res = await fetch(`${API}/multiagent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Chat failed: ${res.status}`);
    }

    const data = await res.json();
    return data.response || "I'm here to help! Type 'start' to begin an analysis.";
  } catch (error) {
    console.error('Chat error:', error);
    return "I'm your Biological Analysis Assistant. Type 'start' to begin an analysis!";
  }
}
