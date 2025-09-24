// server/index.js (snippet)
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/public', express.static(path.join(process.cwd(), 'public')));

const upload = multer({ dest: path.join(process.cwd(), 'uploads') });

app.post('/api/upload', upload.single('file'), async (req, res) => {
  const file = req.file; // .svs/.tif or image/*
  const id = path.parse(file.originalname).name.replace(/\W+/g, '_') + '_' + Date.now();

  // If image/*, just move to public and use as-is
  const isImage = (file.mimetype || '').startsWith('image/');
  const outDir = path.join(process.cwd(), 'public', 'slides', id);
  fs.mkdirSync(outDir, { recursive: true });

  let imageUrl, thumbnailUrl;
  if (isImage) {
    const dest = path.join(outDir, file.originalname);
    fs.renameSync(file.path, dest);
    imageUrl = `/public/slides/${id}/${file.originalname}`;
    thumbnailUrl = imageUrl; // keep simple; you can generate smaller one later
  } else {
    // TODO: generate preview/thumbnail from .svs using openslide/vips
    // For now, return a placeholder so the UI still works
    fs.unlinkSync(file.path);
    imageUrl = 'https://picsum.photos/seed/newslide/1600/1200';
    thumbnailUrl = 'https://picsum.photos/seed/newslide/240/180';
  }

  res.json({ id, name: file.originalname, imageUrl, thumbnailUrl });
});


// Get all slides
app.get('/api/slides', (req, res) => {
  // In a real app, this would read from a database
  // For now, return mock data
  res.json([
    {
      id: 'lung_01',
      name: 'lung_01.svs',
      imageUrl: 'https://picsum.photos/seed/lung/1600/1200',
      thumbnailUrl: 'https://picsum.photos/seed/lung/240/180',
      sourceType: 'uploaded',
    },
  ]);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running!' });
});

// In-memory storage for ROIs (in production, use a database)
const rois = new Map(); // slideId -> ROI[]

// Get ROIs for a slide
app.get('/api/slides/:slideId/rois', (req, res) => {
  const { slideId } = req.params;
  const slideRois = rois.get(slideId) || [];
  res.json(slideRois);
});

// Create a new ROI
app.post('/api/slides/:slideId/rois', (req, res) => {
  const { slideId } = req.params;
  const { name, geometry } = req.body;
  
  const roi = {
    id: `roi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: name || `ROI ${Date.now()}`,
    slideId,
    geometry,
    createdAt: Date.now()
  };
  
  const slideRois = rois.get(slideId) || [];
  slideRois.push(roi);
  rois.set(slideId, slideRois);
  
  res.json(roi);
});

// Update ROI name
app.put('/api/slides/:slideId/rois/:roiId', (req, res) => {
  const { slideId, roiId } = req.params;
  const { name } = req.body;
  
  const slideRois = rois.get(slideId) || [];
  const roi = slideRois.find(r => r.id === roiId);
  
  if (!roi) {
    return res.status(404).json({ error: 'ROI not found' });
  }
  
  roi.name = name;
  res.json(roi);
});

// Delete ROI
app.delete('/api/slides/:slideId/rois/:roiId', (req, res) => {
  const { slideId, roiId } = req.params;
  
  const slideRois = rois.get(slideId) || [];
  const index = slideRois.findIndex(r => r.id === roiId);
  
  if (index === -1) {
    return res.status(404).json({ error: 'ROI not found' });
  }
  
  slideRois.splice(index, 1);
  res.json({ success: true });
});

// Chat endpoint
app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  // Mock chat response
  const responses = [
    `I see you're asking about: "${message}". This appears to be a region of interest in the tissue sample.`,
    `Based on the ROI you've selected, I can observe cellular structures that suggest active immune infiltration.`,
    `The morphological features in this area indicate potential pathological changes worth further investigation.`,
  ];
  const response = responses[Math.floor(Math.random() * responses.length)];
  res.json({ reply: response });
});


// Start server
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
