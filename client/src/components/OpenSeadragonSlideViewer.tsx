import React, { useEffect, useRef, useState, useCallback } from 'react';
import '../styles/openseadragon.css';
import type { Slide, ROI, PipelineRunStatus } from '../types';
import { fetchImageROIs, createImageROI, deleteImageROI, DEFAULT_PROJECT_ID } from '../lib/api';

// Import OpenSeadragon without types (use any for now)
declare const OpenSeadragon: any;

type Props = {
  slides: Slide[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAnalyzeROI?: (roi: ROI, slide: Slide) => void;
  projectId?: string;
  rois?: ROI[];
  selectedROI?: ROI | null;
  onROISelect?: (roi: ROI | null) => void;
  onROICreate?: (roiData: Omit<ROI, 'id' | 'createdAt'>) => Promise<void>;
  onROIUpdate?: (roiId: string, updates: Partial<ROI>) => void;
  onROIDelete?: (roiId: string) => void;
  onRefreshSlide?: (slideId: string) => Promise<void> | void;
};

type OpenSeadragonROI = ROI & {
  overlay?: HTMLElement;
  color?: string;
};

const ROI_COLORS = ['#10b981', '#3b82f6', '#f97316', '#ec4899', '#8b5cf6', '#f59e0b', '#0ea5e9'];

const ROI_STATUS_LABELS: Record<PipelineRunStatus, string> = {
  idle: 'Idle',
  pending: 'Pending',
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Ready',
  failed: 'Failed'
};

const ROI_STATUS_BADGE_CLASSES: Record<PipelineRunStatus, string> = {
  idle: 'bg-gray-100 text-gray-600 border border-gray-200',
  pending: 'bg-amber-100/70 text-amber-700 border border-amber-200',
  queued: 'bg-amber-100/70 text-amber-700 border border-amber-200',
  processing: 'bg-sky-100/80 text-sky-700 border border-sky-200',
  completed: 'bg-emerald-100/80 text-emerald-700 border border-emerald-200',
  failed: 'bg-rose-100/80 text-rose-700 border border-rose-200'
};

const ROI_INFLIGHT_STATUSES: PipelineRunStatus[] = ['pending', 'queued', 'processing'];
const ROI_FAILED_STATUS: PipelineRunStatus = 'failed';
const ROI_NAME_PATTERN = /^roi[\s_-]*(\d+)$/i;
const sanitizeRoiLabel = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
const compareROIOrder = (a: ROI, b: ROI) => {
  const aTime = a.createdAt ?? 0;
  const bTime = b.createdAt ?? 0;
  if (aTime && bTime && aTime !== bTime) {
    return aTime - bTime;
  }
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
};

const isInFlightStatus = (status?: PipelineRunStatus | null) =>
  !!status && ROI_INFLIGHT_STATUSES.includes(status);

const styleNavigatorElement = (container: HTMLElement | null) => {
  if (!container) return;
  const navigatorEl = container.querySelector<HTMLElement>('.openseadragon-navigator');
  if (!navigatorEl) return;

  navigatorEl.style.position = 'absolute';
  navigatorEl.style.top = '16px';
  navigatorEl.style.right = '16px';
  navigatorEl.style.bottom = 'auto';
  navigatorEl.style.left = 'auto';
  navigatorEl.style.width = '160px';
  navigatorEl.style.height = '120px';
  navigatorEl.style.borderRadius = '10px';
  navigatorEl.style.boxShadow = '0 6px 18px rgba(15, 23, 42, 0.18)';
  navigatorEl.style.background = 'rgba(255, 255, 255, 0.92)';
  navigatorEl.style.border = '1px solid rgba(15, 23, 42, 0.12)';
  navigatorEl.style.overflow = 'hidden';
  navigatorEl.style.zIndex = '15';

  const innerCanvas = navigatorEl.querySelector<HTMLElement>('canvas, img, .openseadragon-canvas');
  if (innerCanvas) {
    innerCanvas.style.borderRadius = 'inherit';
  }
};

// Define types for OpenSeadragon objects
interface OSDPoint {
  x: number;
  y: number;
}

interface OSDRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type TileSourceConfig = {
  kind: 'dzi' | 'image';
  url: string;
};

const buildTileSource = (slide: Slide | undefined): TileSourceConfig | null => {
  if (!slide || !slide.dziManifestUrl) {
    return null;
  }
  return { kind: 'dzi', url: slide.dziManifestUrl };
};

export default function OpenSeadragonSlideViewer({
  slides,
  selectedId,
  onSelect,
  onAnalyzeROI,
  projectId,
  rois: externalROIs,
  selectedROI: externalSelectedROI,
  onROISelect,
  onRefreshSlide
}: Props) {
  const selected = slides.find(s => s.id === selectedId) ?? slides[0];
  const projectScope = projectId ?? selected?.projectId ?? DEFAULT_PROJECT_ID;
  const viewerRef = useRef<HTMLDivElement>(null);
  const osdViewerRef = useRef<any>(null);
  const osdModuleRef = useRef<any>(null);
  const initializingRef = useRef<boolean>(false);
  
  const [viewerRois, setViewerRois] = useState<OpenSeadragonROI[]>([]);
  const [viewerSelectedROI, setViewerSelectedROI] = useState<OpenSeadragonROI | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [roiFeedback, setRoiFeedback] = useState<string | null>(null);
  const roisRef = useRef<OpenSeadragonROI[]>([]);
  const roiColorsRef = useRef<Record<string, string>>({});
  const loadROIsRef = useRef<((loaded: ROI[]) => void) | null>(null);
  const roiNameCounterRef = useRef<number>(0);
  const [isRefreshingSlideStatus, setIsRefreshingSlideStatus] = useState(false);

  const syncRoiCounter = useCallback((rois: { name?: string | null }[]) => {
    let highestDetected = 0;

    rois.forEach(roi => {
      if (!roi.name) return;
      const match = ROI_NAME_PATTERN.exec(roi.name);
      if (!match) return;
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value)) {
        highestDetected = Math.max(highestDetected, value);
      }
    });

    roiNameCounterRef.current = highestDetected;
  }, []);

  const getNextRoiName = useCallback(() => {
    const existingNames = new Set(roisRef.current.map(roi => roi.name));
    let candidate = Math.max(roiNameCounterRef.current + 1, 1);
    let attempts = 0;

    while (attempts < 200) {
      const humanName = `ROI ${candidate}`;
      const serverName = sanitizeRoiLabel(humanName);
      if (!existingNames.has(humanName) && !existingNames.has(serverName)) {
        roiNameCounterRef.current = candidate;
        return humanName;
      }
      candidate += 1;
      attempts += 1;
    }

    const fallback = `ROI_${Date.now()}`;
    roiNameCounterRef.current = Math.max(roiNameCounterRef.current, candidate);
    return fallback;
  }, []);

  const tileJob = selected?.pipeline?.preprocess;
  const tileJobStatus = tileJob?.status as PipelineRunStatus | undefined;
  const hasTiles = Boolean(selected?.dziManifestUrl);
  const tileJobInFlight = !hasTiles && isInFlightStatus(tileJobStatus);
  const tileJobFailed = !hasTiles && tileJobStatus === ROI_FAILED_STATUS;
  const tileStatusLabel = tileJobStatus ? ROI_STATUS_LABELS[tileJobStatus] : 'Not started';
  const tileStatusBadgeClass = tileJobStatus
    ? ROI_STATUS_BADGE_CLASSES[tileJobStatus]
    : 'bg-gray-100 text-gray-600 border border-gray-200';
  const showTileGenerationOverlay = !!selected && !hasTiles;

  const selectedROIStatus = (viewerSelectedROI?.status as PipelineRunStatus | undefined) ?? 'completed';
  const selectedROIIsFailed = selectedROIStatus === ROI_FAILED_STATUS;
  const selectedROIIsReady = !!viewerSelectedROI && selectedROIStatus === 'completed';
  const anyRoiInFlight = viewerRois.some(roi =>
    isInFlightStatus((roi.status as PipelineRunStatus | undefined) ?? undefined)
  );
  
  // Use refs to avoid stale closures in event handlers
  const createROIFromRectRef = useRef<((rect: OSDRect) => Promise<void>) | null>(null);
  const findROIAtPointRef = useRef<((point: OSDPoint) => OpenSeadragonROI | null) | null>(null);
  const highlightROIRef = useRef<((roi: OpenSeadragonROI) => void) | null>(null);
  const clearROIHighlightsRef = useRef<(() => void) | null>(null);

  const notifyRoiRejected = useCallback((message: string) => {
    console.warn(`[ROI] ${message}`);
    setRoiFeedback(message);
  }, []);

  useEffect(() => {
    // Clear ROI state when project or image changes
    setViewerRois([]);
    roisRef.current = [];
    roiColorsRef.current = {};
    setViewerSelectedROI(null);
    setViewerReady(false);
    setRoiFeedback(null);
    onROISelect?.(null);
    setViewerError(null);
    
    // Also clear any OpenSeadragon overlays when project/image changes
    const viewer = osdViewerRef.current;
    if (viewer && viewer.clearOverlays) {
      try {
        viewer.clearOverlays();
      } catch (err) {
        console.warn('Error clearing overlays on project/image change:', err);
      }
    }
  }, [selected?.id, projectScope, onROISelect]);

  const ensureOverlayPointerEvents = useCallback((element: HTMLElement | null) => {
    if (!element) return;

    const mark = (node: HTMLElement) => {
      node.style.pointerEvents = 'none';
      node.style.touchAction = 'none';
      if (!node.classList.contains('osd-overlay-no-events')) {
        node.classList.add('osd-overlay-no-events');
      }
    };

    mark(element);

    const parent = element.parentElement as HTMLElement | null;
    if (parent && parent.classList.contains('openseadragon-overlay')) {
      mark(parent);
      if (!parent.style.zIndex) {
        parent.style.zIndex = '10';
      }
    }
  }, []);

  const resetViewerPointerEvents = useCallback(() => {
    if (!viewerRef.current) return;

    const interactiveSelectors = [
      '.openseadragon-container',
      '.openseadragon-canvas',
      '.openseadragon-canvas > canvas'
    ];

    interactiveSelectors.forEach(selector => {
      viewerRef.current!
        .querySelectorAll<HTMLElement>(selector)
        .forEach(node => {
          node.style.pointerEvents = 'auto';
          node.style.touchAction = 'auto';
        });
    });
  }, []);

  const applyNavigatorStyle = useCallback(() => {
    styleNavigatorElement(viewerRef.current);
  }, []);

  const formatTimestamp = useCallback((timestamp?: number | null) => {
    if (!timestamp) return null;
    try {
      return new Date(timestamp).toLocaleString();
    } catch (err) {
      console.warn('Failed to format timestamp', err);
      return null;
    }
  }, []);

  const hexToRgba = useCallback((hex: string, alpha: number) => {
    let normalized = hex.replace('#', '');
    if (normalized.length === 3) {
      normalized = normalized.split('').map(char => char + char).join('');
    }
    const bigint = parseInt(normalized, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }, []);

  const assignROIColor = useCallback((roi: OpenSeadragonROI, index?: number) => {
    if (roi.color) {
      roiColorsRef.current[roi.id] = roi.color;
      return roi.color;
    }

    const existing = roiColorsRef.current[roi.id];
    if (existing) {
      roi.color = existing;
      return existing;
    }

    const order = typeof index === 'number' ? index : Object.keys(roiColorsRef.current).length;
    const color = ROI_COLORS[order % ROI_COLORS.length];
    roiColorsRef.current[roi.id] = color;
    roi.color = color;
    return color;
  }, []);

  // Initialize OpenSeadragon viewer
  useEffect(() => {
    const container = viewerRef.current;

    if (!container || !selected) {
      setIsLoading(false);
      setViewerError(null);
      return;
    }

    const tileSource = buildTileSource(selected);

    if (!tileSource) {
      container.innerHTML = '';
      setIsLoading(false);
      return;
    }

    // Prevent concurrent initialization
    if (initializingRef.current) {
      console.warn('OpenSeadragon initialization already in progress, skipping...');
      return;
    }

  setIsLoading(true);
  setViewerError(null);

    // Destroy any existing viewer before creating a new one
    if (osdViewerRef.current) {
      try {
        osdViewerRef.current.destroy();
      } catch (err) {
        console.warn('Error destroying previous OpenSeadragon viewer:', err);
      }
      osdViewerRef.current = null;
      osdModuleRef.current = null;
    }

    // Ensure container is completely clean after destroying viewer
    // This prevents background image overlap issues
    if (container) {
      // Remove ALL children to ensure no leftover openseadragon-container divs
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      // Reset inline styles that might persist
      container.style.background = '#fafafa';
    }

    initializingRef.current = true;

    // Import OpenSeadragon dynamically to avoid typing issues
  import('openseadragon')
      .then((OSD) => {
        const OpenSeadragon = OSD.default ?? (OSD as any);
        if (!OpenSeadragon) {
          throw new Error('OpenSeadragon module did not provide a default export');
        }

        osdModuleRef.current = OpenSeadragon;

        if (!container || !container.isConnected) {
          console.warn('OpenSeadragon container is no longer mounted; skipping initialization.');
          setIsLoading(false);
          initializingRef.current = false;
          return;
        }

        // Double-check container is still clean (no leftover .openseadragon-container)
        const existingOSD = container.querySelector('.openseadragon-container');
        if (existingOSD) {
          container.removeChild(existingOSD);
        }

      const openSeaDragonTileSource = tileSource.kind === 'dzi'
        ? tileSource.url
        : { type: 'image', url: tileSource.url };

      osdViewerRef.current = OpenSeadragon({
        element: container,
        tileSources: openSeaDragonTileSource,
        prefixUrl: 'https://openseadragon.github.io/openseadragon/images/',
        animationTime: 0.3,
    showNavigationControl: false, // We'll use custom controls
    showZoomControl: false,
    showHomeControl: false,
    showFullPageControl: false,
    showNavigator: true,
        gestureSettingsMouse: {
          clickToZoom: false,
          dblClickToZoom: true,
          dblClickDragToZoom: false,
          dragToPan: true,        // ← FIXED: Enable drag to pan
          scrollToZoom: true,      // ← FIXED: Enable scroll to zoom
          flickEnabled: false
        },
        zoomPerScroll: 1.2,
        constrainDuringPan: false,  // Allow panning beyond image bounds
        visibilityRatio: 0.0001,        // Only require 0.01% of image to be visible
        defaultZoomLevel: 1,
        minZoomLevel: 0.1,
        maxZoomLevel: 10,
        wrapHorizontal: false,
        wrapVertical: false,
        crossOriginPolicy: 'Anonymous',
        ajaxWithCredentials: false,
        drawer: 'canvas'
      });

      setupEventHandlers(OpenSeadragon);
      
      // Guard against duplicate tile sources
      osdViewerRef.current.addHandler('add-item', (event: any) => {
        const itemCount = osdViewerRef.current?.world?.getItemCount?.();
        if (itemCount && itemCount > 1) {
          console.warn(`OpenSeadragon world has ${itemCount} items, removing duplicates...`);
          // Remove all items except the first one
          for (let i = itemCount - 1; i >= 1; i--) {
            const item = osdViewerRef.current.world.getItemAt(i);
            if (item) {
              osdViewerRef.current.world.removeItem(item);
            }
          }
        }
      });
      
      // Track zoom changes
      osdViewerRef.current.addHandler('zoom', (event: any) => {
        setZoomLevel(event.zoom);
      });
      
      // Load ROIs after viewer is ready
      osdViewerRef.current.addHandler('open', () => {
        // Ensure only one tile source exists
        const itemCount = osdViewerRef.current?.world?.getItemCount?.();
        if (itemCount && itemCount > 1) {
          console.warn(`After open: world has ${itemCount} items, keeping only the first`);
          for (let i = itemCount - 1; i >= 1; i--) {
            const item = osdViewerRef.current.world.getItemAt(i);
            if (item) {
              osdViewerRef.current.world.removeItem(item);
            }
          }
        }
        
        setIsLoading(false);
        setViewerError(null);
        setViewerReady(true);
        initializingRef.current = false;
        applyNavigatorStyle();
        
        // ROIs will be loaded by the useEffect that watches externalROIs and viewerReady
        // This prevents double-loading ROIs
        
        // Ensure the image fits nicely
        setTimeout(() => {
          osdViewerRef.current?.viewport?.goHome(true);
        }, 50);
      });

      osdViewerRef.current.addHandler('open-failed', (event: any) => {
        console.error('OpenSeadragon failed to open image:', event);
        setIsLoading(false);
        setViewerReady(false);
        initializingRef.current = false;
        setViewerError(
          tileSource.kind === 'dzi'
            ? 'Deep Zoom tiles are not ready yet. Please retry once preprocessing completes.'
            : 'Unable to display this image. Please try again or choose another slide.'
        );
        applyNavigatorStyle();
      });
      })
      .catch((error: unknown) => {
        console.error('Failed to load OpenSeadragon:', error);
        setIsLoading(false);
        initializingRef.current = false;
      });

    return () => {
      // Cleanup function
      initializingRef.current = false;
      
      if (osdViewerRef.current) {
        try {
          osdViewerRef.current.destroy();
        } catch (err) {
          console.warn('Error destroying viewer:', err);
        }
        osdViewerRef.current = null;
      }
      
      osdModuleRef.current = null;
      
      // Clean the container thoroughly to prevent background overlap
      if (viewerRef.current) {
        // Remove all children completely
        while (viewerRef.current.firstChild) {
          viewerRef.current.removeChild(viewerRef.current.firstChild);
        }
        // Reset background to prevent old images from showing
        viewerRef.current.style.background = '#fafafa';
      }

      setViewerReady(false);
    };
  }, [selected?.id, selected?.dziManifestUrl, projectScope]);

  const handleRetryLoad = useCallback(() => {
    const viewer = osdViewerRef.current;
    if (!viewer || !selected) {
      return;
    }
    const tileSource = buildTileSource(selected);
    if (!tileSource) {
      return;
    }
    setViewerError(null);
    setIsLoading(true);
    try {
      // Close existing tile sources before opening new one to prevent duplicates
      viewer.close();
      const source = tileSource.kind === 'dzi' ? tileSource.url : { type: 'image', url: tileSource.url };
      viewer.open(source);
    } catch (error) {
      console.error('Retry load failed:', error);
      setIsLoading(false);
      setViewerError('Failed to reload slide. Please wait a moment and try again.');
    }
  }, [selected?.id, selected?.dziManifestUrl]);

  const handleRefreshSlideStatus = useCallback(async () => {
    if (!selected?.id || !onRefreshSlide) {
      return;
    }

    try {
      setIsRefreshingSlideStatus(true);
      await Promise.resolve(onRefreshSlide(selected.id));
    } catch (error) {
      console.error('Failed to refresh slide status:', error);
    } finally {
      setIsRefreshingSlideStatus(false);
    }
  }, [onRefreshSlide, selected?.id]);

  useEffect(() => {
    roisRef.current = viewerRois;
    syncRoiCounter(viewerRois);
    resetViewerPointerEvents();
    viewerRef.current?.querySelectorAll<HTMLElement>('.openseadragon-overlay')
      .forEach(ensureOverlayPointerEvents);
  }, [viewerRois, ensureOverlayPointerEvents, resetViewerPointerEvents, syncRoiCounter]);

  useEffect(() => {
    if (!roiFeedback) return;
    const timeout = window.setTimeout(() => setRoiFeedback(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [roiFeedback]);

  const setupEventHandlers = useCallback((OpenSeadragon: any) => {
    const viewer = osdViewerRef.current;
    if (!viewer) return;

    let isMouseDown = false;
    let startPoint: OSDPoint | null = null;
    let currentOverlay: HTMLElement | null = null;

    const cleanupOverlay = () => {
      if (currentOverlay) {
        try {
          viewer.removeOverlay(currentOverlay);
        } catch (err) {
          console.warn('Failed to remove temporary ROI overlay:', err);
        }
        currentOverlay = null;
      }
      startPoint = null;
      isMouseDown = false;
      setIsDrawing(false);
    };

    const finalizeDrawing = (event?: any) => {
      if (!isMouseDown || !startPoint) {
        cleanupOverlay();
        return;
      }

      let currentPoint: OSDPoint;
      if (event?.position) {
        currentPoint = viewer.viewport.pointFromPixel(event.position);
      } else {
        currentPoint = startPoint;
      }

      const rect = new OpenSeadragon.Rect(
        Math.min(startPoint.x, currentPoint.x),
        Math.min(startPoint.y, currentPoint.y),
        Math.abs(currentPoint.x - startPoint.x),
        Math.abs(currentPoint.y - startPoint.y)
      );

      cleanupOverlay();

      // Check size in viewport coordinates - must be reasonable for current zoom level
      // At zoom level 1, minimum 0.01 (1% of image width) is reasonable
      // At zoom level 10, we can create much smaller ROIs
      const zoom = viewer.viewport.getZoom();
      const minSize = 0.001 / zoom; // Adjust minimum based on zoom level
      
      if (rect.width > minSize && rect.height > minSize) {
        createROIFromRectRef.current?.(rect);
      } else {
        notifyRoiRejected('ROI too small at this zoom. Drag a larger box or zoom out slightly.');
      }
    };

    // Mouse down - start drawing ROI
    viewer.addHandler('canvas-press', (event: any) => {
      if (event.originalEvent.ctrlKey || event.originalEvent.metaKey) {
        event.preventDefaultAction = true;
        isMouseDown = true;
        
        // Convert screen coordinates to viewport coordinates
        startPoint = viewer.viewport.pointFromPixel(event.position);
        
        // Create temporary overlay for drawing
        currentOverlay = document.createElement('div');
        currentOverlay.className = 'roi-drawing border-2 border-blue-500 bg-blue-100/20 absolute pointer-events-none';
        
        // Add overlay to viewer
        viewer.addOverlay({
          element: currentOverlay,
          location: new OpenSeadragon.Rect(startPoint!.x, startPoint!.y, 0, 0)
        });
        ensureOverlayPointerEvents(currentOverlay);

        setIsDrawing(true);
      }
    });

    // Mouse move - update drawing ROI
    viewer.addHandler('canvas-drag', (event: any) => {
      if (isMouseDown && startPoint && currentOverlay) {
        event.preventDefaultAction = true;
        
        const currentPoint = viewer.viewport.pointFromPixel(event.position);
        
        // Calculate rectangle in viewport coordinates
        const rect = new OpenSeadragon.Rect(
          Math.min(startPoint.x, currentPoint.x),
          Math.min(startPoint.y, currentPoint.y),
          Math.abs(currentPoint.x - startPoint.x),
          Math.abs(currentPoint.y - startPoint.y)
        );

        // Update overlay
        viewer.updateOverlay(currentOverlay, rect);
      }
    });

    // Mouse up - finish drawing ROI
    viewer.addHandler('canvas-release', (event: any) => {
      if (!isMouseDown) return;
      event.preventDefaultAction = true;
      finalizeDrawing(event);
    });

    // Safety: ensure we finalize even if drag ends outside canvas
    viewer.addHandler('canvas-drag-end', (event: any) => {
      if (!isMouseDown) return;
      event.preventDefaultAction = true;
      finalizeDrawing(event);
    });

    viewer.addHandler('canvas-exit', () => {
      if (!isMouseDown) return;
      finalizeDrawing();
    });

    // Click on existing ROI
    viewer.addHandler('canvas-click', (event: any) => {
      if (!event.originalEvent.ctrlKey && !event.originalEvent.metaKey) {
        const viewportPoint = viewer.viewport.pointFromPixel(event.position);
        const clickedROI = findROIAtPointRef.current?.(viewportPoint);
        
        if (clickedROI) {
          event.preventDefaultAction = true;
          setViewerSelectedROI(clickedROI);
          highlightROIRef.current?.(clickedROI);
          onROISelect?.(clickedROI);
        } else {
          setViewerSelectedROI(null);
          clearROIHighlightsRef.current?.();
          onROISelect?.(null);
        }
      }
    });
  }, [ensureOverlayPointerEvents, onROISelect, notifyRoiRejected]);
  // ☝️ Removed rois, selected, projectScope from dependencies since we use refs for callbacks

  const createROIFromRect = useCallback(async (rect: OSDRect) => {
    if (!selected) return;

    try {
      const viewer = osdViewerRef.current;
      if (!viewer || !viewer.world || viewer.world.getItemCount() === 0) {
        console.error('Viewer not ready for ROI creation');
        return;
      }

  // Get the tiled image to get proper dimensions
  const tiledImage = viewer.world.getItemAt(0);
  const imageSize = tiledImage.getContentSize();
  const sourceDimensions = tiledImage.source?.dimensions;
  const imageWidth = sourceDimensions?.x ?? imageSize.x;
  const imageHeight = sourceDimensions?.y ?? imageSize.y;
      
      if (!imageSize) {
        console.error('Could not get image size');
        return;
      }

      // Convert viewport coordinates to image pixel coordinates
      // OpenSeadragon uses a UNIFORM coordinate system where image width = 1.0
      // Both X and Y axes use the same scale (imageWidth) to maintain aspect ratio
      // For a 10000×5000 image: viewport (0.5, 0.25) = pixel (5000, 2500)
      // Note: Y also uses imageWidth (not imageHeight) - this is correct!
  const actualImageWidth = imageWidth || imageSize.x;
  const actualImageHeight = imageHeight || imageSize.y;
      
      const rawGeometry = {
        x: rect.x * actualImageWidth,
        y: rect.y * actualImageWidth,        // Uses imageWidth for uniform scale ✓
        w: rect.width * actualImageWidth,
        h: rect.height * actualImageWidth   // Uses imageWidth for uniform scale ✓
      };
      
      // Clamp to image boundaries - ensure ROI stays within image bounds
      // Clamp start position
      const clampedX = Math.max(0, Math.min(actualImageWidth, rawGeometry.x));
      const clampedY = Math.max(0, Math.min(actualImageHeight, rawGeometry.y));
      
      // Clamp end position
      const endX = Math.min(actualImageWidth, rawGeometry.x + rawGeometry.w);
  const endY = Math.min(actualImageHeight, rawGeometry.y + rawGeometry.h);
      
      // Calculate clamped width and height
      const imageGeometry = {
        x: clampedX,
        y: clampedY,
        w: Math.max(0, endX - clampedX),
        h: Math.max(0, endY - clampedY)
      };

      // Ensure minimum size based on current zoom level.
      const zoom = viewer.viewport?.getZoom?.() ?? 1;
      const baseViewportThreshold = 0.00001; // 0.001% of the image width at zoom level 1
      const minViewportSize = baseViewportThreshold / Math.max(zoom, 0.01);
      const zoomAwareMinPx = Math.max(0.5, 3 / Math.max(zoom, 0.1));
  const minSizePxX = Math.max(zoomAwareMinPx, minViewportSize * actualImageWidth);
  const minSizePxY = Math.max(zoomAwareMinPx, minViewportSize * actualImageWidth);

      if (imageGeometry.w < minSizePxX || imageGeometry.h < minSizePxY) {
        notifyRoiRejected(
          `ROI too small (~${Math.round(imageGeometry.w)}×${Math.round(imageGeometry.h)} px). Need at least ${minSizePxX.toFixed(1)}×${minSizePxY.toFixed(1)} px at this zoom.`
        );
        return;
      }

  const name = getNextRoiName();
  const newROI = await createImageROI(selected.id, name, imageGeometry, projectScope);
      
      // Add overlay for the new ROI - filter to only keep ROIs for current image/project
      const roiWithOverlay: OpenSeadragonROI = { ...newROI, overlay: undefined };
      assignROIColor(roiWithOverlay);

      setViewerRois(prev => {
        const filtered = prev.filter(r => 
          r.imageId === selected.id && r.projectId === projectScope && r.id !== roiWithOverlay.id
        );
        const next = [...filtered, roiWithOverlay].sort(compareROIOrder);
        return next;
      });

      // Wait a moment for the viewer to stabilize before adding overlay
      setTimeout(() => {
        addROIOverlay(roiWithOverlay);
        setViewerSelectedROI(roiWithOverlay);
        highlightROIRef.current?.(roiWithOverlay);
        onROISelect?.(roiWithOverlay);
        setRoiFeedback(null);
      }, 120);
    } catch (error) {
      console.error('Failed to create ROI:', error);
    }
  }, [selected, projectScope, onROISelect, notifyRoiRejected, getNextRoiName]);
  
  // Assign to ref so event handlers can access the latest version
  useEffect(() => {
    createROIFromRectRef.current = createROIFromRect;
  }, [createROIFromRect]);

  const addROIOverlay = (roi: OpenSeadragonROI) => {
    const viewer = osdViewerRef.current;
    if (!viewer || !viewer.world || viewer.world.getItemCount() === 0) {
      return;
    }

    // Get image size
    const tiledImage = viewer.world.getItemAt(0);
    if (!tiledImage) return;
    
    const imageSize = tiledImage.getContentSize();
    if (!imageSize) return;
    
    // Get actual image dimensions
  const imageWidth = tiledImage.source.dimensions?.x || imageSize.x;

    // Create ROI element
    const roiElement = document.createElement('div');
    const color = assignROIColor(roi);
    const status = (roi.status as PipelineRunStatus | undefined) ?? 'completed';
    const backgroundIntensity = status === 'completed' ? 0.18 : status === ROI_FAILED_STATUS ? 0.22 : 0.1;
    const baseBackground = hexToRgba(color, backgroundIntensity);
    const borderStyle = status === ROI_FAILED_STATUS ? '2px dashed' : '2px solid';
    const overlayOpacity = status === 'completed' ? '1' : '0.85';
    roiElement.className = 'roi-overlay';
    roiElement.style.cssText = `
      border: ${borderStyle} ${color};
      background: ${baseBackground};
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      overflow: visible;
      transition: box-shadow 0.2s ease;
      pointer-events: none;
      opacity: ${overlayOpacity};
    `;
    roiElement.dataset.color = color;
    roiElement.dataset.roiId = roi.id;
    
    // Add label
    const label = document.createElement('div');
    label.className = 'roi-label';
    label.style.cssText = `
      position: absolute;
      top: -24px;
      left: 0;
      font-size: 12px;
      background: ${color};
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
      pointer-events: none;
    `;
    label.textContent = roi.name;
    if (status !== 'completed') {
      const statusBadge = document.createElement('span');
      statusBadge.textContent = ` • ${ROI_STATUS_LABELS[status]}`;
      statusBadge.style.fontWeight = '500';
      statusBadge.style.opacity = '0.95';
      label.appendChild(statusBadge);
    }
    roiElement.appendChild(label);

    // Note: ROI selection is handled by canvas-click handler using findROIAtPoint
    // This is because pointer-events: none allows pan/zoom to work through the overlay

    // Convert image pixel coordinates to viewport coordinates
    // OpenSeadragon uses UNIFORM scaling: both X and Y divide by imageWidth
    // This is the inverse of the forward conversion in createROIFromRect
    // For a 10000×5000 image: pixel (5000, 2500) = viewport (0.5, 0.25)
  const module = osdModuleRef.current;
  const RectCtor = module?.Rect;
  const placement = module?.Placement?.TOP_LEFT;
    const viewportRect = RectCtor
      ? new RectCtor(
          roi.geometry.x / imageWidth,
          roi.geometry.y / imageWidth,        // Uses imageWidth (not Height) ✓
          roi.geometry.w / imageWidth,
          roi.geometry.h / imageWidth         // Uses imageWidth (not Height) ✓
        )
      : {
          x: roi.geometry.x / imageWidth,
          y: roi.geometry.y / imageWidth,
          width: roi.geometry.w / imageWidth,
          height: roi.geometry.h / imageWidth
        };

    // Add overlay
    try {
      if (RectCtor && placement) {
        viewer.addOverlay(roiElement, viewportRect, placement);
      } else {
        viewer.addOverlay({
          element: roiElement,
          location: viewportRect
        });
      }
      ensureOverlayPointerEvents(roiElement);
      roi.overlay = roiElement;
    } catch (error) {
      console.error('Failed to add ROI overlay:', error);
    }
  };

  const addResizeHandles = (roiElement: HTMLElement) => {
    const handles = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'];
    
    handles.forEach(handle => {
      const handleElement = document.createElement('div');
      handleElement.className = `resize-handle resize-handle-${handle} absolute w-2 h-2 bg-red-500 border border-white cursor-${handle}-resize`;
      
      // Position handles
      const positions: Record<string, string> = {
        'nw': 'top: -4px; left: -4px;',
        'ne': 'top: -4px; right: -4px;',
        'sw': 'bottom: -4px; left: -4px;',
        'se': 'bottom: -4px; right: -4px;',
        'n': 'top: -4px; left: 50%; transform: translateX(-50%);',
        's': 'bottom: -4px; left: 50%; transform: translateX(-50%);',
        'w': 'top: 50%; left: -4px; transform: translateY(-50%);',
        'e': 'top: 50%; right: -4px; transform: translateY(-50%);'
      };
      
      handleElement.style.cssText = positions[handle];
      roiElement.appendChild(handleElement);
    });
  };

  const loadROIs = (loadedROIs: ROI[]) => {
    const viewer = osdViewerRef.current;
    if (!viewer) return;

    // Clear existing overlays
    viewer.clearOverlays();

    const filteredROIs = selected?.id
      ? loadedROIs.filter(roi => roi.imageId === selected.id && roi.projectId === projectScope)
      : loadedROIs.filter(roi => roi.projectId === projectScope);

    const uniqueROIs = filteredROIs.filter((roi, index, arr) =>
      arr.findIndex(candidate => candidate.id === roi.id) === index
    );

    const orderedROIs = uniqueROIs.slice().sort(compareROIOrder);

    // Add overlays for all ROIs
    const roisWithOverlays: OpenSeadragonROI[] = orderedROIs.map((roi, index) => {
      const extended: OpenSeadragonROI = { ...roi, overlay: undefined };
      assignROIColor(extended, index);
      return extended;
    });

    syncRoiCounter(roisWithOverlays);
    
    // Wait a bit for the viewer to be fully ready
    setTimeout(() => {
      roisWithOverlays.forEach(roi => {
        addROIOverlay(roi);
      });

      if (viewerSelectedROI?.id) {
        const match = roisWithOverlays.find(r => r.id === viewerSelectedROI.id);
        if (match) {
          setViewerSelectedROI(match);
          applyNavigatorStyle();
        } else {
          setViewerSelectedROI(null);
          clearROIHighlights();
          onROISelect?.(null);
        }
      } else {
        clearROIHighlights();
      }
    }, 100);
    
    const currentIds = new Set(roisWithOverlays.map(r => r.id));
    Object.keys(roiColorsRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        delete roiColorsRef.current[id];
      }
    });
    setViewerRois(roisWithOverlays);
  };

  loadROIsRef.current = loadROIs;

  useEffect(() => {
    if (!viewerReady) return;
    if (!selected?.id) return;

    if (externalROIs !== undefined) {
      loadROIsRef.current?.(externalROIs);
    } else {
      fetchImageROIs(selected.id, projectScope).then((loadedROIs) => {
        loadROIsRef.current?.(loadedROIs);
      }).catch((error) => {
        console.error('Failed to fetch ROIs:', error);
      });
    }
  }, [externalROIs, viewerReady, projectScope, selected?.id]);

  const highlightROI = useCallback((roi: OpenSeadragonROI) => {
    // Update all ROI overlays to show selection state
    roisRef.current.forEach(r => {
      if (!r.overlay) return;
      const color = assignROIColor(r);
      const status = (r.status as PipelineRunStatus | undefined) ?? 'completed';
      const baseAlpha = status === 'completed' ? 0.18 : status === ROI_FAILED_STATUS ? 0.22 : 0.1;
      const highlightAlpha = Math.min(baseAlpha + 0.16, 0.45);
      const baseBg = hexToRgba(color, baseAlpha);
      const highlightBg = hexToRgba(color, highlightAlpha);
      const isTarget = r.id === roi.id;
      r.overlay.style.background = isTarget ? highlightBg : baseBg;
      r.overlay.style.borderColor = color;
      r.overlay.style.boxShadow = isTarget ? `0 0 12px ${hexToRgba(color, 0.45)}` : 'none';

      const labelEl = r.overlay.querySelector('.roi-label') as HTMLElement | null;
      if (labelEl) {
        labelEl.style.backgroundColor = color;
      }
    });
  }, [assignROIColor, hexToRgba]);
  
  useEffect(() => {
    highlightROIRef.current = highlightROI;
  }, [highlightROI]);

  const clearROIHighlights = useCallback(() => {
    roisRef.current.forEach(roi => {
      if (!roi.overlay) return;
      const color = assignROIColor(roi);
      const status = (roi.status as PipelineRunStatus | undefined) ?? 'completed';
      const baseAlpha = status === 'completed' ? 0.18 : status === ROI_FAILED_STATUS ? 0.22 : 0.1;
      roi.overlay.style.background = hexToRgba(color, baseAlpha);
      roi.overlay.style.borderColor = color;
      roi.overlay.style.boxShadow = 'none';
      const labelEl = roi.overlay.querySelector('.roi-label') as HTMLElement | null;
      if (labelEl) {
        labelEl.style.backgroundColor = color;
      }
    });
  }, [assignROIColor, hexToRgba]);
  
  useEffect(() => {
    clearROIHighlightsRef.current = clearROIHighlights;
  }, [clearROIHighlights]);

  useEffect(() => {
    if (externalSelectedROI === undefined) {
      return;
    }

    if (externalSelectedROI === null) {
      if (viewerSelectedROI) {
        setViewerSelectedROI(null);
        clearROIHighlights();
      }
      return;
    }

    if (viewerSelectedROI?.id === externalSelectedROI.id) {
      return;
    }

    const match = roisRef.current.find(r => r.id === externalSelectedROI.id);
    if (match) {
      setViewerSelectedROI(match);
      highlightROIRef.current?.(match);
    }
  }, [externalSelectedROI, viewerSelectedROI, viewerRois, clearROIHighlights]);

  const findROIAtPoint = useCallback((point: OSDPoint): OpenSeadragonROI | null => {
    const viewer = osdViewerRef.current;
    if (!viewer) return null;

  const tiledImage = viewer.world.getItemAt(0);
  if (!tiledImage) return null;
  const imageSize = tiledImage.getContentSize();
  if (!imageSize) return null;
  const imageWidth = tiledImage.source.dimensions?.x || imageSize.x;
    
    const imagePoint = {
      x: point.x * imageWidth,
      y: point.y * imageWidth
    };

    return roisRef.current.find(roi => {
      return imagePoint.x >= roi.geometry.x &&
             imagePoint.x <= roi.geometry.x + roi.geometry.w &&
             imagePoint.y >= roi.geometry.y &&
             imagePoint.y <= roi.geometry.y + roi.geometry.h;
    }) || null;
  }, []);
  
  useEffect(() => {
    findROIAtPointRef.current = findROIAtPoint;
  }, [findROIAtPoint]);

  const deleteROI = async (roi: OpenSeadragonROI) => {
    const imageId = roi.imageId ?? selected?.id;
    if (!imageId) return;

    try {
  await deleteImageROI(imageId, roi.id, projectScope);
      
      // Remove overlay
      if (roi.overlay && osdViewerRef.current) {
        osdViewerRef.current.removeOverlay(roi.overlay);
      }
      delete roiColorsRef.current[roi.id];
      
      setViewerRois(prev => prev.filter(r => r.id !== roi.id));
      if (viewerSelectedROI?.id === roi.id) {
        setViewerSelectedROI(null);
        onROISelect?.(null);
      }
      clearROIHighlights();
    } catch (error) {
      console.error('Failed to delete ROI:', error);
    }
  };

  useEffect(() => {
    if (!selected?.id || !osdViewerRef.current) return;

    const imageId = selected.id;

    const hasInFlight = viewerRois.some(roi =>
      isInFlightStatus((roi.status as PipelineRunStatus | undefined) ?? undefined)
    );

    if (!hasInFlight) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
  const latest = await fetchImageROIs(imageId, projectScope);
        if (!cancelled) {
          loadROIsRef.current?.(latest);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to refresh ROI statuses:', error);
        }
      }
    };

    const intervalId = window.setInterval(poll, 4000);
    poll();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [viewerRois, selected?.id, projectScope]);

  return (
    <div className="flex h-full bg-gray-50">
      {/* Left: Slide Selection */}
      <div className="w-48 p-4 bg-white border-r border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Slide Collection</h3>
        <div className="space-y-2">
          {slides.map(s => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`w-full rounded-lg overflow-hidden border-2 transition-all duration-200 hover:shadow-md ${
                s.id === selected?.id 
                  ? 'border-blue-500 ring-2 ring-blue-200' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              title={s.name}
            >
              <div
                className={`w-full h-16 flex items-center justify-center text-xs font-semibold ${
                  s.dziManifestUrl
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {s.dziManifestUrl ? 'Tiles ready' : 'Waiting for tiles'}
              </div>
              <div className="p-2 text-xs text-left">
                <div className="font-medium truncate">{s.name}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Center: Main Viewer */}
      <div className="flex-1 flex flex-col">
        {/* Viewer Container */}
        <div className="flex-1 relative bg-white m-4 rounded-xl shadow-sm border border-gray-200">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <div className="flex items-center space-x-3">
              <h2 className="text-lg font-semibold text-gray-800">{selected?.name}</h2>
              <div className="text-sm text-gray-500">
                Zoom: {Math.round(zoomLevel * 100)}%
              </div>
            </div>
          </div>

          {/* Viewer with Zoom Controls Overlay */}
          <div className="relative h-full" style={{ minHeight: '480px' }}>
            <div 
              ref={viewerRef}
              id="osd-viewer-container"
              className="absolute inset-0 rounded-lg border border-gray-200"
              style={{ background: '#fafafa' }}
            />
            
            {/* Loading overlay */}
            {isLoading && (
              <div className="absolute inset-0 bg-white/80 rounded-lg flex items-center justify-center z-20">
                <div className="flex items-center space-x-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="text-gray-600 font-medium">Loading slide...</span>
                </div>
              </div>
            )}

            {viewerError && !isLoading && (
              <div className="absolute inset-0 bg-white/90 rounded-lg flex flex-col items-center justify-center z-20 px-6 text-center space-y-4">
                <div className="text-gray-700 text-sm leading-relaxed">{viewerError}</div>
                <button
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg shadow hover:bg-blue-700"
                  onClick={handleRetryLoad}
                >
                  Retry loading slide
                </button>
              </div>
            )}

            {showTileGenerationOverlay && (
              <div className="absolute inset-0 bg-white/95 rounded-lg flex items-center justify-center z-30 px-6 py-8 text-center">
                <div className="max-w-md space-y-5">
                  <div className="flex flex-col items-center space-y-3">
                    {tileJobFailed ? (
                      <div className="w-14 h-14 rounded-full bg-rose-50 border border-rose-200 text-rose-500 flex items-center justify-center text-2xl font-semibold">
                        !
                      </div>
                    ) : (
                      <div className="w-14 h-14 rounded-full border-2 border-blue-100 flex items-center justify-center">
                        <span className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                    <div>
                      <p className="text-lg font-semibold text-slate-800">
                        {tileJobFailed
                          ? 'Tile generation failed'
                          : tileJobInFlight
                            ? 'Generating Deep Zoom tiles'
                            : 'Waiting for Deep Zoom tiles'}
                      </p>
                      <p className="text-sm text-slate-600">
                        {tileJobFailed
                          ? 'The preprocessing job reported an error. Resolve it, then refresh the slide status.'
                          : tileJobInFlight
                            ? 'We are building the Deep Zoom pyramid so you can explore this slide. This usually takes a few minutes.'
                            : 'Tile generation has not started yet. Kick off preprocessing or refresh the slide status to check again.'}
                      </p>
                    </div>
                  </div>

                  <div className="text-sm text-left space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Status</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${tileStatusBadgeClass}`}>
                        {tileJobInFlight && (
                          <span className="inline-flex items-center justify-center w-2.5 h-2.5">
                            <span className="w-2 h-2 border-[2px] border-current border-t-transparent rounded-full animate-spin" />
                          </span>
                        )}
                        <span>{tileStatusLabel}</span>
                      </span>
                    </div>
                    {tileJob?.jobId && (
                      <div className="flex items-center justify-between text-slate-600">
                        <span className="text-slate-500 font-medium">Job ID</span>
                        <code className="text-xs bg-white px-2 py-0.5 rounded border border-slate-200">{tileJob.jobId}</code>
                      </div>
                    )}
                    {tileJob?.updatedAt && (
                      <div className="flex items-center justify-between text-slate-600">
                        <span className="text-slate-500 font-medium">Last update</span>
                        <span className="text-xs text-slate-700">{formatTimestamp(tileJob.updatedAt) ?? '—'}</span>
                      </div>
                    )}
                  </div>

                  {tileJob?.error && (
                    <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-4 py-3 text-left">
                      {tileJob.error}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 justify-center">
                    <button
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg shadow hover:bg-blue-700 disabled:bg-blue-300 disabled:hover:bg-blue-300 disabled:cursor-not-allowed"
                      disabled={!onRefreshSlide || isRefreshingSlideStatus}
                      onClick={handleRefreshSlideStatus}
                    >
                      {isRefreshingSlideStatus ? 'Checking...' : 'Check status again'}
                    </button>
                  </div>

                  <p className="text-xs text-slate-500">
                    We will automatically open the slide as soon as its Deep Zoom manifest is ready. You can continue working while preprocessing finishes.
                  </p>
                </div>
              </div>
            )}
            
            {/* Zoom Controls - Top Left Corner */}
            <div className="absolute top-4 left-4 z-10 flex flex-col bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
              <button 
                className="w-8 h-8 flex items-center justify-center text-lg font-bold text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors border-b border-gray-200"
                onClick={() => osdViewerRef.current?.viewport.zoomBy(1.3)}
                title="Zoom In"
              >
                +
              </button>
              <button 
                className="w-8 h-8 flex items-center justify-center text-lg font-bold text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors border-b border-gray-200"
                onClick={() => osdViewerRef.current?.viewport.zoomBy(0.77)}
                title="Zoom Out"
              >
                -
              </button>
              <button 
                className="w-8 h-8 flex items-center justify-center text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                onClick={() => osdViewerRef.current?.viewport.goHome()}
                title="Reset View"
              >
                ⌂
              </button>
            </div>

            {/* Drawing Mode Indicator */}
            {isDrawing && (
              <div className="absolute top-4 right-4 z-10 bg-blue-500 text-white px-3 py-2 rounded-lg shadow-lg">
                <div className="text-sm font-medium">Drawing ROI...</div>
                <div className="text-xs opacity-90">Release to finish</div>
              </div>
            )}

            {roiFeedback && (
              <div className="absolute bottom-4 right-4 z-20 max-w-xs bg-slate-900/80 text-white px-4 py-3 rounded-lg shadow-lg">
                <div className="text-sm font-semibold">ROI not created</div>
                <div className="text-xs mt-1 leading-snug">{roiFeedback}</div>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-600">
            <div className="flex items-center justify-between">
              <span><kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl/Cmd</kbd> + Drag to create ROI</span>
              <span>Click ROI to select • Mouse wheel to zoom • Drag to pan</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: ROI Management Panel */}
      <div className="w-72 bg-white border-l border-gray-200 flex flex-col">
        {/* ROI Controls Header */}
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Regions of Interest</h3>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span>{viewerRois.length} ROI{viewerRois.length !== 1 ? 's' : ''}</span>
            {viewerSelectedROI && (
              <span className="text-blue-600 font-medium">Selected: {viewerSelectedROI.name}</span>
            )}
          </div>
          {anyRoiInFlight && (
            <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              ROI processing is in progress. Status updates will appear automatically.
            </div>
          )}
        </div>

        {/* ROI List */}
        <div className="flex-1 p-4 overflow-y-auto">
          {viewerRois.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-400 mb-2">
                <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8V4a2 2 0 012-2h2M4 16v4a2 2 0 002 2h2M16 4h2a2 2 0 012 2v4M16 20h2a2 2 0 002-2v-4" />
                </svg>
              </div>
              <div className="text-sm text-gray-500 mb-1">No ROIs created</div>
              <div className="text-xs text-gray-400">Hold Ctrl/Cmd and drag on the image to create a region</div>
            </div>
          ) : (
            <div className="space-y-2">
              {viewerRois.map((roi) => {
                const status = (roi.status as PipelineRunStatus | undefined) ?? 'completed';
                const inFlight = isInFlightStatus(status);
                const isFailed = status === ROI_FAILED_STATUS;
                const isSelected = viewerSelectedROI?.id === roi.id;
                const statusClasses = ROI_STATUS_BADGE_CLASSES[status];
                const statusLabel = ROI_STATUS_LABELS[status];

                return (
                  <div 
                    key={roi.id}
                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 shadow-sm'
                        : isFailed
                          ? 'border-rose-300 bg-rose-50/60 hover:border-rose-300 hover:bg-rose-50'
                          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                    }`}
                    onClick={() => {
                      setViewerSelectedROI(roi);
                      highlightROI(roi);
                      onROISelect?.(roi);
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm text-gray-800">{roi.name}</div>
                      <div className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-semibold ${statusClasses}`}>
                        {inFlight && (
                          <span className="inline-flex items-center justify-center w-2.5 h-2.5">
                            <span className="w-2 h-2 border-[2px] border-current border-t-transparent rounded-full animate-spin" />
                          </span>
                        )}
                        <span>{statusLabel}</span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 space-y-1">
                      <div>Size: {Math.round(roi.geometry.w)} × {Math.round(roi.geometry.h)} px</div>
                      <div>Position: ({Math.round(roi.geometry.x)}, {Math.round(roi.geometry.y)})</div>
                      {roi.jobId && (
                        <div className="text-[11px] text-gray-400">Job ID: {roi.jobId}</div>
                      )}
                    </div>
                    {isFailed && roi.error && (
                      <div className="mt-2 text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-2 py-1">
                        {roi.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ROI Actions */}
        {viewerSelectedROI && (
          <div className="p-4 border-t border-gray-100 bg-gray-50">
            <div className="space-y-3">
              {onAnalyzeROI && selected && (
                <>
                  <button
                    className={`w-full px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
                      selectedROIIsReady
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-blue-200 text-blue-700 cursor-not-allowed'
                    }`}
                    disabled={!selectedROIIsReady}
                    onClick={() => onAnalyzeROI(viewerSelectedROI, selected)}
                    title={selectedROIIsReady ? 'View ROI details and use Multiagent panel for analysis' : 'ROI is still being processed'}
                  >
                    {selectedROIIsReady ? '📊 Analyze ROI' : 'ROI Not Ready'}
                  </button>
                  {!selectedROIIsReady && !selectedROIIsFailed && (
                    <p className="text-xs text-gray-500">
                      The ROI is still being processed. This usually takes a few minutes—feel free to keep exploring.
                    </p>
                  )}
                  {selectedROIIsFailed && viewerSelectedROI?.error && (
                    <p className="text-xs text-rose-600">
                      Processing failed: {viewerSelectedROI.error}
                    </p>
                  )}
                </>
              )}
              <button
                className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-sm"
                onClick={() => deleteROI(viewerSelectedROI)}
              >
                Delete ROI
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}