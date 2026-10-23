'use strict';

/*
 * Convert one licensed TotalSegmentator MRI case into the small browser volume
 * format used by the atlas. The source NIfTI files are read-only and are not
 * kept in the repository. Usage:
 *   node tools/prepare_mri_volume.cjs <source-directory>
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const sourceDirectory = process.argv[2];
if (!sourceDirectory) throw Error('Usage: node tools/prepare_mri_volume.cjs <source-directory>');

const outputDirectory = path.resolve(__dirname, '..', 'public', 'data');
const targetSpacing = 3;
const labels = [
  ['autochthon_left', '左豎脊肌群', '肌肉', [224, 91, 94]],
  ['autochthon_right', '右豎脊肌群', '肌肉', [228, 133, 74]],
  ['iliopsoas_left', '左髂腰肌', '肌肉', [218, 103, 162]],
  ['iliopsoas_right', '右髂腰肌', '肌肉', [175, 106, 226]],
  ['heart', '心臟', '心血管', [225, 95, 110]],
  ['lung_left', '左肺', '呼吸', [81, 184, 208]],
  ['lung_right', '右肺', '呼吸', [62, 152, 190]],
  ['liver', '肝臟', '內臟', [202, 145, 74]],
  ['spleen', '脾臟', '內臟', [166, 103, 188]],
  ['stomach', '胃', '內臟', [103, 176, 115]],
  ['colon', '結腸', '內臟', [114, 155, 207]],
  ['small_bowel', '小腸', '內臟', [103, 192, 170]],
  ['kidney_left', '左腎臟', '泌尿生殖', [100, 136, 225]],
  ['kidney_right', '右腎臟', '泌尿生殖', [104, 113, 200]],
  ['vertebrae', '脊椎', '骨骼', [220, 205, 115]],
  ['intervertebral_discs', '椎間盤', '骨骼', [180, 180, 185]],
  ['spinal_cord', '脊髓', '神經', [246, 155, 83]],
  ['sacrum', '薦骨', '骨骼', [194, 171, 135]],
  ['hip_left', '左髖骨', '骨骼', [151, 190, 116]],
  ['hip_right', '右髖骨', '骨骼', [122, 171, 92]]
];

function readNifti(file) {
  const bytes = zlib.gunzipSync(fs.readFileSync(file));
  const littleEndian = bytes.readInt32LE(0) === 348;
  if (!littleEndian) throw Error(`${file} is not a supported little-endian NIfTI-1 file`);
  const dimensions = [bytes.readInt16LE(42), bytes.readInt16LE(44), bytes.readInt16LE(46)];
  const datatype = bytes.readInt16LE(70);
  const bitpix = bytes.readInt16LE(72);
  const offset = Math.trunc(bytes.readFloatLE(108));
  const slope = bytes.readFloatLE(112) || 1;
  const intercept = bytes.readFloatLE(116) || 0;
  const spacing = [bytes.readFloatLE(80), bytes.readFloatLE(84), bytes.readFloatLE(88)];
  const voxelCount = dimensions.reduce((total, n) => total * n, 1);
  const data = new Int16Array(voxelCount);
  const stride = bitpix / 8;
  if (datatype !== 2 && datatype !== 4 && datatype !== 16) throw Error(`${file} has unsupported NIfTI datatype ${datatype}`);
  for (let i = 0, cursor = offset; i < voxelCount; i++, cursor += stride) {
    const raw = datatype === 2 ? bytes.readUInt8(cursor) : datatype === 4 ? bytes.readInt16LE(cursor) : bytes.readFloatLE(cursor);
    data[i] = Math.round(raw * slope + intercept);
  }
  return {data, dimensions, spacing};
}

function index(shape, x, y, z) {
  return x + shape[0] * (y + shape[1] * z);
}

function coordinate(outputIndex, outputLength, inputLength) {
  return outputLength <= 1 ? 0 : outputIndex * (inputLength - 1) / (outputLength - 1);
}

function trilinear(source, outputShape) {
  const result = new Int16Array(outputShape[0] * outputShape[1] * outputShape[2]);
  const [inX, inY, inZ] = source.dimensions;
  for (let z = 0; z < outputShape[2]; z++) {
    const sourceZ = coordinate(z, outputShape[2], inZ);
    const z0 = Math.floor(sourceZ), z1 = Math.min(inZ - 1, z0 + 1), tz = sourceZ - z0;
    for (let y = 0; y < outputShape[1]; y++) {
      const sourceY = coordinate(y, outputShape[1], inY);
      const y0 = Math.floor(sourceY), y1 = Math.min(inY - 1, y0 + 1), ty = sourceY - y0;
      for (let x = 0; x < outputShape[0]; x++) {
        const sourceX = coordinate(x, outputShape[0], inX);
        const x0 = Math.floor(sourceX), x1 = Math.min(inX - 1, x0 + 1), tx = sourceX - x0;
        const value = (ix, iy, iz) => source.data[index(source.dimensions, ix, iy, iz)];
        const c00 = value(x0,y0,z0) * (1 - tx) + value(x1,y0,z0) * tx;
        const c10 = value(x0,y1,z0) * (1 - tx) + value(x1,y1,z0) * tx;
        const c01 = value(x0,y0,z1) * (1 - tx) + value(x1,y0,z1) * tx;
        const c11 = value(x0,y1,z1) * (1 - tx) + value(x1,y1,z1) * tx;
        result[index(outputShape, x, y, z)] = Math.round((c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz);
      }
    }
  }
  return result;
}

function nearestMask(source, outputShape) {
  const result = new Uint8Array(outputShape[0] * outputShape[1] * outputShape[2]);
  for (let z = 0; z < outputShape[2]; z++) for (let y = 0; y < outputShape[1]; y++) for (let x = 0; x < outputShape[0]; x++) {
    const sourceX = Math.round(coordinate(x, outputShape[0], source.dimensions[0]));
    const sourceY = Math.round(coordinate(y, outputShape[1], source.dimensions[1]));
    const sourceZ = Math.round(coordinate(z, outputShape[2], source.dimensions[2]));
    result[index(outputShape, x, y, z)] = source.data[index(source.dimensions, sourceX, sourceY, sourceZ)] > 0 ? 1 : 0;
  }
  return result;
}

function organStatistics(mask, shape, id) {
  let count = 0, sumX = 0, sumY = 0, sumZ = 0;
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (let z = 0; z < shape[2]; z++) for (let y = 0; y < shape[1]; y++) for (let x = 0; x < shape[0]; x++) {
    if (mask[index(shape, x, y, z)] !== id) continue;
    count++; sumX += x; sumY += y; sumZ += z;
    if (x < minimum[0]) minimum[0] = x; if (x > maximum[0]) maximum[0] = x;
    if (y < minimum[1]) minimum[1] = y; if (y > maximum[1]) maximum[1] = y;
    if (z < minimum[2]) minimum[2] = z; if (z > maximum[2]) maximum[2] = z;
  }
  if (!count) return null;
  const centroid = [sumX / count, sumY / count, sumZ / count];
  let center = [0,0,0], nearestDistance = Infinity;
  for (let z = 0; z < shape[2]; z++) for (let y = 0; y < shape[1]; y++) for (let x = 0; x < shape[0]; x++) {
    if (mask[index(shape, x, y, z)] !== id) continue;
    const distance = (x - centroid[0]) ** 2 + (y - centroid[1]) ** 2 + (z - centroid[2]) ** 2;
    if (distance < nearestDistance) { nearestDistance = distance; center = [x,y,z]; }
  }
  return {center, bounds:[[minimum[0],maximum[0]],[minimum[1],maximum[1]],[minimum[2],maximum[2]]]};
}

const volume = readNifti(path.join(sourceDirectory, 'mri.nii.gz'));
const outputShape = volume.dimensions.map((size, axis) => Math.max(1, Math.round(size * volume.spacing[axis] / targetSpacing)));
const mri = trilinear(volume, outputShape);
const segmentation = new Uint8Array(mri.length);
const organs = [];

for (const [key, name, category, color] of labels) {
  const source = readNifti(path.join(sourceDirectory, `${key}.nii.gz`));
  if (source.dimensions.join('×') !== volume.dimensions.join('×')) throw Error(`${key} shape does not match MRI`);
  const mask = nearestMask(source, outputShape);
  if (!mask.some(Boolean)) continue;
  const id = organs.length + 1;
  for (let i = 0; i < mask.length; i++) if (mask[i]) segmentation[i] = id;
  organs.push({id, name, key, category, color});
}

for (const organ of organs) Object.assign(organ, organStatistics(segmentation, outputShape, organ.id));

fs.mkdirSync(outputDirectory, {recursive:true});
fs.writeFileSync(path.join(outputDirectory, 'm0006-mr.gz'), zlib.gzipSync(Buffer.from(mri.buffer), {level:9}));
fs.writeFileSync(path.join(outputDirectory, 'm0006-seg.gz'), zlib.gzipSync(Buffer.from(segmentation.buffer), {level:9}));

const metadata = {
  id: 'm0006',
  title: 'MRI・胸腹部（實際 MRI，序列未明）',
  modality: 'MRI',
  volumeFile: 'mr',
  shape: outputShape,
  spacing: [targetSpacing, targetSpacing, targetSpacing],
  organs,
  sourceCase: 's0006',
  sourceShape: volume.dimensions,
  sourceSpacing: volume.spacing,
  sequence: '原始公開中繼資料未提供可可靠辨識的 MRI 序列；不標示為 T1、T2 或其他序列。',
  contrast: 'MRI 訊號強度，不適用 HU',
  license: 'CC BY-NC-SA 2.0',
  source: 'https://zenodo.org/records/14710732',
  sourceMirror: 'https://huggingface.co/datasets/MedOtter/TotalSegmentatorMR',
  attribution: 'TotalSegmentator MRI dataset v2.0.0，病例 s0006；衍生資料僅限非商業使用。'
};
fs.writeFileSync(path.join(outputDirectory, 'm0006.json'), JSON.stringify(metadata), 'utf8');

const catalogFile = path.join(outputDirectory, 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8')).filter(item => item.id !== metadata.id);
catalog.push({id:metadata.id, title:metadata.title, contrast:metadata.contrast, modality:metadata.modality});
fs.writeFileSync(catalogFile, JSON.stringify(catalog), 'utf8');
console.log(`m0006 ${outputShape.join('×')} ${organs.length} labeled structures`);
