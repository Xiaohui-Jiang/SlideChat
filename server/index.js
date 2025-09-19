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
