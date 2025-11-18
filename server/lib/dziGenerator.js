import sharp from 'sharp';
import path from 'path';
import { promises as fs } from 'fs';
import { existsSync, mkdirSync } from 'fs';

const dziLocks = new Map();

async function statOrNull(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function ensureDirSync(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

function withLock(lockMap, key, factory) {
  if (lockMap.has(key)) {
    return lockMap.get(key);
  }

  const promise = (async () => {
    try {
      return await factory();
    } finally {
      lockMap.delete(key);
    }
  })();

  lockMap.set(key, promise);
  return promise;
}

async function isTilesDirUsable(tilesDir) {
  try {
    const entries = await fs.readdir(tilesDir, { withFileTypes: true });
    if (!entries.length) {
      return false;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const levelDir = path.join(tilesDir, entry.name);
      try {
        const levelEntries = await fs.readdir(levelDir);
        if (levelEntries.length > 0) {
          return true;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    return false;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function safeCopyFile(source, destination) {
  if (source === destination) {
    return;
  }
  await fs.rm(destination, { force: true }).catch(() => {});
  await fs.copyFile(source, destination);
}

export async function ensureDzi({
  sourcePath,
  manifestPath,
  tileSize = 512,
  overlap = 0,
  format = 'jpeg'
}) {
  if (!sourcePath || !manifestPath) {
    throw new Error('sourcePath and manifestPath are required');
  }

  return withLock(dziLocks, manifestPath, async () => {
    const sourceStat = await statOrNull(sourcePath);
    if (!sourceStat) {
      throw new Error(`Source image not found: ${sourcePath}`);
    }

    const tilesDir = manifestPath.replace(/\.dzi$/i, '_files');
    const manifestDir = path.dirname(manifestPath);
    ensureDirSync(manifestDir);

    const aliasManifestPath = path.join(manifestDir, 'manifest.dzi');
    const manifestStat = await statOrNull(manifestPath);
    const aliasStat = await statOrNull(aliasManifestPath);
    const tilesUsable = await isTilesDirUsable(tilesDir);

    if (
      manifestStat &&
      tilesUsable &&
      manifestStat.mtimeMs >= sourceStat.mtimeMs &&
      manifestStat.size > 0
    ) {
      if (!aliasStat || aliasStat.mtimeMs < manifestStat.mtimeMs || aliasStat.size === 0) {
        await safeCopyFile(manifestPath, aliasManifestPath);
      }
      return { manifestPath: aliasManifestPath, tilesDir };
    }

    await fs.rm(tilesDir, { recursive: true, force: true }).catch(() => {});

    const manifestBase = manifestPath.replace(/\.dzi$/i, '');
    const tempSuffix = `.tmp-${process.pid}-${Date.now()}`;
    const tempOutputBase = `${manifestBase}${tempSuffix}`;
    const tempManifest = `${tempOutputBase}.dzi`;
    const tempTilesDir = `${tempOutputBase}_files`;

    try {
      await sharp(sourcePath, { limitInputPixels: false, sequentialRead: true })
        .rotate()
        .tile({
          size: tileSize,
          overlap,
          layout: 'dz',
          format,
          center: false
  })
  .toFile(tempOutputBase);
    } catch (error) {
      await fs.rm(tempManifest, { force: true }).catch(() => {});
      await fs.rm(tempTilesDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    await fs.rm(manifestPath, { force: true }).catch(() => {});
    await fs.rm(aliasManifestPath, { force: true }).catch(() => {});
    await fs.rm(tilesDir, { recursive: true, force: true }).catch(() => {});

    await fs.rename(tempTilesDir, tilesDir).catch(async (error) => {
      await fs.rm(tempManifest, { force: true }).catch(() => {});
      await fs.rm(tempTilesDir, { recursive: true, force: true }).catch(() => {});
      if (error.code === 'ENOENT') {
        // If the tiles dir was not created as expected, rethrow for visibility.
        throw new Error(`Failed to locate generated tiles at ${tempTilesDir}`);
      }
      throw error;
    });
    await fs.rename(tempManifest, manifestPath).catch(async (error) => {
      await fs.rm(tempManifest, { force: true }).catch(() => {});
      await fs.rm(tilesDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    });
    await safeCopyFile(manifestPath, aliasManifestPath);

    return { manifestPath: aliasManifestPath, tilesDir };
  });
}
