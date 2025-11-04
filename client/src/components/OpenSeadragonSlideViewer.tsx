import React, { useEffect, useRef, useState, useCallback } from 'react';
import '../styles/openseadragon.css';
import type { Slide, ROI } from '../types';
import { fetchImageROIs, createImageROI, deleteImageROI, DEFAULT_PROJECT_ID } from '../lib/api';

// Import OpenSeadragon without types (use any for now)
declare const OpenSeadragon: any;

type Props = {
  slides: Slide[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAnalyzeROI?: (roi: ROI, slide: Slide) => void;
  projectId?: string;
};

type OpenSeadragonROI = ROI & {
  overlay?: HTMLElement;
  color?: string;
};

const ROI_COLORS = ['#10b981', '#3b82f6', '#f97316', '#ec4899', '#8b5cf6', '#f59e0b', '#0ea5e9'];

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

export default function OpenSeadragonSlideViewer({ slides, selectedId, onSelect, onAnalyzeROI, projectId }: Props) {
  const selected = slides.find(s => s.id === selectedId) ?? slides[0];
  const projectScope = projectId ?? selected?.projectId ?? DEFAULT_PROJECT_ID;
  const viewerRef = useRef<HTMLDivElement>(null);
  const osdViewerRef = useRef<any>(null);
  const osdModuleRef = useRef<any>(null);
  const initedRef = useRef(false); // Guard against double initialization
  
  const [rois, setRois] = useState<OpenSeadragonROI[]>([]);
  const [selectedROI, setSelectedROI] = useState<OpenSeadragonROI | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(true);
  const roisRef = useRef<OpenSeadragonROI[]>([]);
  const roiColorsRef = useRef<Record<string, string>>({});
  
  // Use refs to avoid stale closures in event handlers
  const createROIFromRectRef = useRef<((rect: OSDRect) => Promise<void>) | null>(null);
  const findROIAtPointRef = useRef<((point: OSDPoint) => OpenSeadragonROI | null) | null>(null);
  const highlightROIRef = useRef<((roi: OpenSeadragonROI) => void) | null>(null);
  const clearROIHighlightsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setRois([]);
    roisRef.current = [];
    roiColorsRef.current = {};
    setSelectedROI(null);
  }, [selected?.id, projectScope]);

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
    // Guard against double initialization (StrictMode)
    if (!viewerRef.current || !selected || initedRef.current) return;

    setIsLoading(true);
    initedRef.current = true;

    // Ensure container is clean
    if (viewerRef.current) {
      viewerRef.current.innerHTML = '';
    }

    // Import OpenSeadragon dynamically to avoid typing issues
    import('openseadragon')
      .then((OSD) => {
        const OpenSeadragon = OSD.default;
        osdModuleRef.current = OpenSeadragon;
      
        // Ensure we don't create a viewer if already destroyed
        if (!initedRef.current) return;
        
      osdViewerRef.current = OpenSeadragon({
        element: viewerRef.current,
        tileSources: {
          type: 'image',
          url: selected.imageUrl
        },
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
      
      // Track zoom changes
      osdViewerRef.current.addHandler('zoom', (event: any) => {
        setZoomLevel(event.zoom);
      });
      
      // Load ROIs after viewer is ready
      osdViewerRef.current.addHandler('open', () => {
        setIsLoading(false);
        applyNavigatorStyle();
        if (selected?.id) {
          console.log('🔄 Image opened, fetching ROIs:', { imageId: selected.id, projectId: projectScope });
          fetchImageROIs(selected.id, projectScope).then((loadedROIs) => {
            console.log('📦 Fetched ROIs from server:', loadedROIs.length);
            loadROIs(loadedROIs);
          });
        }

        // Ensure the image fits nicely
        setTimeout(() => {
          osdViewerRef.current?.viewport?.goHome(true);
        }, 50);
      });

      osdViewerRef.current.addHandler('open-failed', (event: any) => {
        console.error('OpenSeadragon failed to open image:', event);
        setIsLoading(false);
  applyNavigatorStyle();
      });
      })
      .catch((error: unknown) => {
        console.error('Failed to load OpenSeadragon:', error);
        setIsLoading(false);
        initedRef.current = false;
      });

    return () => {
      // Cleanup function
      initedRef.current = false;
      
      if (osdViewerRef.current) {
        try {
          osdViewerRef.current.destroy();
        } catch (err) {
          console.warn('Error destroying viewer:', err);
        }
        osdViewerRef.current = null;
      }
      
      osdModuleRef.current = null;
  applyNavigatorStyle();
      
      // Clean the container
      if (viewerRef.current) {
        viewerRef.current.innerHTML = '';
      }
    };
  }, [selected?.id, projectScope, applyNavigatorStyle]);

  useEffect(() => {
    roisRef.current = rois;
    resetViewerPointerEvents();
    viewerRef.current?.querySelectorAll<HTMLElement>('.openseadragon-overlay')
      .forEach(ensureOverlayPointerEvents);
  }, [rois, ensureOverlayPointerEvents, resetViewerPointerEvents]);

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

      console.log('🎯 Finalizing drawing:', {
        startPoint: { x: startPoint.x, y: startPoint.y },
        currentPoint: { x: currentPoint.x, y: currentPoint.y },
        eventPosition: event?.position
      });

      const rect = new OpenSeadragon.Rect(
        Math.min(startPoint.x, currentPoint.x),
        Math.min(startPoint.y, currentPoint.y),
        Math.abs(currentPoint.x - startPoint.x),
        Math.abs(currentPoint.y - startPoint.y)
      );

      console.log('📦 Final rect (viewport coords):', {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      });

      cleanupOverlay();

      // Check size in viewport coordinates - must be reasonable for current zoom level
      // At zoom level 1, minimum 0.01 (1% of image width) is reasonable
      // At zoom level 10, we can create much smaller ROIs
      const zoom = viewer.viewport.getZoom();
      const minSize = 0.001 / zoom; // Adjust minimum based on zoom level
      
      if (rect.width > minSize && rect.height > minSize) {
        createROIFromRectRef.current?.(rect);
      } else {
        console.log('⚠️ Rect too small, not creating ROI:', rect.width, rect.height, 'zoom:', zoom, 'minSize:', minSize);
      }
    };

    // Mouse down - start drawing ROI
    viewer.addHandler('canvas-press', (event: any) => {
      if (event.originalEvent.ctrlKey || event.originalEvent.metaKey) {
        event.preventDefaultAction = true;
        isMouseDown = true;
        
        // Convert screen coordinates to viewport coordinates
        startPoint = viewer.viewport.pointFromPixel(event.position);
        
        console.log('ROI creation started at viewport coords:', startPoint);
        console.log('Current zoom level:', viewer.viewport.getZoom());
        console.log('Screen position:', event.position);
        
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
          setSelectedROI(clickedROI);
          highlightROIRef.current?.(clickedROI);
        } else {
          setSelectedROI(null);
          clearROIHighlightsRef.current?.();
        }
      }
    });
  }, [ensureOverlayPointerEvents]);
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
      const imageBounds = tiledImage.getBounds();
      const imageWidth = tiledImage.source.dimensions.x;
      const imageHeight = tiledImage.source.dimensions.y;
      
      console.log('🖼️ Image dimension details:', {
        contentSize: imageSize,
        bounds: imageBounds,
        sourceDimensions: { x: imageWidth, y: imageHeight },
        viewportBounds: viewer.viewport.getBounds()
      });
      
      if (!imageSize) {
        console.error('Could not get image size');
        return;
      }

      // Convert viewport coordinates to image pixel coordinates
      // OpenSeadragon viewport coordinates are normalized (image width = 1.0)
      // Use source dimensions for accurate pixel coordinates
      const actualImageWidth = imageWidth || imageSize.x;
      const actualImageHeight = imageHeight || imageSize.y;
      
      const rawGeometry = {
        x: rect.x * actualImageWidth,
        y: rect.y * actualImageWidth,  // Note: viewport Y is based on image width!
        w: rect.width * actualImageWidth,
        h: rect.height * actualImageWidth
      };
      
      console.log('🔍 Coordinate conversion:', {
        viewport: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        actualImageSize: { x: actualImageWidth, y: actualImageHeight },
        contentSize: { x: imageSize.x, y: imageSize.y },
        raw: rawGeometry,
        aspectRatio: actualImageHeight / actualImageWidth,
        viewportYRange: `0 to ${actualImageHeight / actualImageWidth}`,
        withinBounds: {
          x: rawGeometry.x >= 0 && rawGeometry.x <= actualImageWidth,
          y: rawGeometry.y >= 0 && rawGeometry.y <= actualImageHeight,
          right: (rawGeometry.x + rawGeometry.w) <= actualImageWidth,
          bottom: (rawGeometry.y + rawGeometry.h) <= actualImageHeight
        }
      });

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

      console.log('📏 Clamping details:', {
        raw: rawGeometry,
        clamped: imageGeometry,
        imageBounds: { x: actualImageWidth, y: actualImageHeight }
      });

      // Ensure minimum size
      if (imageGeometry.w < 10 || imageGeometry.h < 10) {
        console.log('❌ ROI too small, skipping creation:', imageGeometry);
        return;
      }

      console.log('✅ Creating ROI with geometry:', imageGeometry);
      console.log('📐 Viewport rect:', rect);
      console.log('📏 Image size:', imageSize);

  const name = `ROI ${roisRef.current.length + 1}`;
  const newROI = await createImageROI(selected.id, name, imageGeometry, projectScope);
      
      console.log('✅ Created ROI:', { 
        id: newROI.id, 
        name: newROI.name, 
        projectId: newROI.projectId, 
        imageId: newROI.imageId 
      });
      
      // Add overlay for the new ROI - filter to only keep ROIs for current image/project
      const roiWithOverlay: OpenSeadragonROI = { ...newROI, overlay: undefined };
      assignROIColor(roiWithOverlay);

      setRois(prev => {
        const filtered = prev.filter(r => 
          r.imageId === selected.id && r.projectId === projectScope && r.id !== roiWithOverlay.id
        );
        console.log('🔄 ROI state update:', { 
          previousCount: prev.length, 
          afterFilter: filtered.length, 
          newTotal: filtered.length + 1 
        });
        return [...filtered, roiWithOverlay];
      });

      // Wait a moment for the viewer to stabilize before adding overlay
      setTimeout(() => {
        addROIOverlay(roiWithOverlay);
        setSelectedROI(roiWithOverlay);
        highlightROI(roiWithOverlay);
      }, 120);
    } catch (error) {
      console.error('Failed to create ROI:', error);
    }
  }, [selected, projectScope]);
  
  // Assign to ref so event handlers can access the latest version
  useEffect(() => {
    createROIFromRectRef.current = createROIFromRect;
  }, [createROIFromRect]);

  const addROIOverlay = (roi: OpenSeadragonROI) => {
    const viewer = osdViewerRef.current;
    if (!viewer || !viewer.world || viewer.world.getItemCount() === 0) {
      console.log('Viewer not ready for ROI overlay');
      return;
    }

    // Get image size
    const tiledImage = viewer.world.getItemAt(0);
    if (!tiledImage) return;
    
    const imageSize = tiledImage.getContentSize();
    if (!imageSize) return;
    
    // Get actual image dimensions
    const imageWidth = tiledImage.source.dimensions?.x || imageSize.x;
    const imageHeight = tiledImage.source.dimensions?.y || imageSize.y;

    // Create ROI element
    const roiElement = document.createElement('div');
    const color = assignROIColor(roi);
    const baseBackground = hexToRgba(color, 0.18);
    roiElement.className = 'roi-overlay';
    roiElement.style.cssText = `
      border: 2px solid ${color};
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
    roiElement.appendChild(label);

    // Note: ROI selection is handled by canvas-click handler using findROIAtPoint
    // This is because pointer-events: none allows pan/zoom to work through the overlay

    // Convert image pixel coordinates to viewport coordinates
    // In OpenSeadragon, viewport coords are normalized where image width = 1.0
    // Both X and Y use the same scale (based on image width)
  const module = osdModuleRef.current;
  const RectCtor = module?.Rect;
  const placement = module?.Placement?.TOP_LEFT;
    const viewportRect = RectCtor
      ? new RectCtor(
          roi.geometry.x / imageWidth,
          roi.geometry.y / imageWidth,  // Note: divide by imageWidth, not imageHeight!
          roi.geometry.w / imageWidth,
          roi.geometry.h / imageWidth
        )
      : {
          x: roi.geometry.x / imageWidth,
          y: roi.geometry.y / imageWidth,  // Note: divide by imageWidth, not imageHeight!
          width: roi.geometry.w / imageWidth,
          height: roi.geometry.h / imageWidth
        };

    console.log('Adding ROI overlay:', roi.name, {
      pixelGeometry: roi.geometry,
      viewportRect: viewportRect,
      imageSize: { width: imageWidth, height: imageHeight }
    });

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

    console.log('📥 loadROIs called:', { 
      totalLoaded: loadedROIs.length, 
      currentImage: selected?.id,
      currentProject: projectScope,
      roisData: loadedROIs.map(r => ({ id: r.id, name: r.name, imageId: r.imageId, projectId: r.projectId }))
    });

    // Clear existing overlays
    viewer.clearOverlays();

    const filteredROIs = selected?.id
      ? loadedROIs.filter(roi => roi.imageId === selected.id && roi.projectId === projectScope)
      : loadedROIs.filter(roi => roi.projectId === projectScope);

    console.log('🔍 Filtered ROIs:', { 
      beforeFilter: loadedROIs.length, 
      afterFilter: filteredROIs.length,
      filtered: filteredROIs.map(r => ({ id: r.id, name: r.name, imageId: r.imageId }))
    });

    const uniqueROIs = filteredROIs.filter((roi, index, arr) =>
      arr.findIndex(candidate => candidate.id === roi.id) === index
    );

    // Add overlays for all ROIs
    const roisWithOverlays: OpenSeadragonROI[] = uniqueROIs.map((roi, index) => {
      const extended: OpenSeadragonROI = { ...roi, overlay: undefined };
      assignROIColor(extended, index);
      return extended;
    });
    
    // Wait a bit for the viewer to be fully ready
    setTimeout(() => {
      roisWithOverlays.forEach(roi => {
        console.log('Adding ROI:', roi.name, roi.geometry);
        addROIOverlay(roi);
      });

      if (selectedROI?.id) {
        const match = roisWithOverlays.find(r => r.id === selectedROI.id);
        if (match) {
          setSelectedROI(match);
  applyNavigatorStyle();
        } else {
          clearROIHighlights();
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

    setRois(roisWithOverlays);
  };

  const highlightROI = useCallback((roi: OpenSeadragonROI) => {
    // Update all ROI overlays to show selection state
    roisRef.current.forEach(r => {
      if (!r.overlay) return;
      const color = assignROIColor(r);
      const baseBg = hexToRgba(color, 0.18);
      const highlightBg = hexToRgba(color, 0.32);
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
      roi.overlay.style.background = hexToRgba(color, 0.18);
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

  const findROIAtPoint = useCallback((point: OSDPoint): OpenSeadragonROI | null => {
    const viewer = osdViewerRef.current;
    if (!viewer) return null;

    const tiledImage = viewer.world.getItemAt(0);
    const imageSize = tiledImage.getContentSize();
    const imageWidth = tiledImage.source.dimensions?.x || imageSize.x;
    
    // Convert viewport point to pixel coordinates
    // Both X and Y use imageWidth as the scale
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
      
      setRois(prev => prev.filter(r => r.id !== roi.id));
      if (selectedROI?.id === roi.id) {
        setSelectedROI(null);
      }
      clearROIHighlights();
    } catch (error) {
      console.error('Failed to delete ROI:', error);
    }
  };

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
              <img src={s.thumbnailUrl} alt={s.name} className="w-full h-16 object-cover" />
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
            <span>{rois.length} ROI{rois.length !== 1 ? 's' : ''}</span>
            {selectedROI && (
              <span className="text-blue-600 font-medium">Selected: {selectedROI.name}</span>
            )}
          </div>
        </div>

        {/* ROI List */}
        <div className="flex-1 p-4 overflow-y-auto">
          {rois.length === 0 ? (
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
              {rois.map((roi) => (
                <div 
                  key={roi.id}
                  className={`p-3 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                    selectedROI?.id === roi.id 
                      ? 'border-blue-500 bg-blue-50 shadow-sm' 
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                  }`}
                  onClick={() => {
                    setSelectedROI(roi);
                    highlightROI(roi);
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-sm text-gray-800">{roi.name}</div>
                    {selectedROI?.id === roi.id && (
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 space-y-1">
                    <div>Size: {Math.round(roi.geometry.w)} × {Math.round(roi.geometry.h)} px</div>
                    <div>Position: ({Math.round(roi.geometry.x)}, {Math.round(roi.geometry.y)})</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ROI Actions */}
        {selectedROI && (
          <div className="p-4 border-t border-gray-100 bg-gray-50">
            <div className="space-y-2">
              {onAnalyzeROI && selected && (
                <button
                  className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors text-sm"
                  onClick={() => onAnalyzeROI(selectedROI, selected)}
                >
                  Analyze ROI
                </button>
              )}
              <button
                className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-sm"
                onClick={() => deleteROI(selectedROI)}
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