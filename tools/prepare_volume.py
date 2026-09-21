"""Build teaching volumes from licensed TotalSegmentator v3 NIfTI data.
Requires nibabel, numpy and scipy. The originals are not modified.
"""
import pathlib,json,gzip,sys,colorsys
import numpy as np
import nibabel as nib
from nibabel.processing import resample_to_output,resample_from_to
root=pathlib.Path(sys.argv[1]); out=pathlib.Path(__file__).parent.parent/'public/data';out.mkdir(exist_ok=True)
names={'brain':'腦','skull':'顱骨','spinal_cord':'脊髓','thyroid_gland':'甲狀腺','trachea':'氣管','esophagus':'食道','heart':'心臟','atrial_appendage_left':'左心耳','aorta':'主動脈','brachiocephalic_trunk':'頭臂幹','inferior_vena_cava':'下腔靜脈','superior_vena_cava':'上腔靜脈','pulmonary_vein':'肺靜脈','pulmonary_artery':'肺動脈','liver':'肝臟','spleen':'脾臟','stomach':'胃','pancreas':'胰臟','gallbladder':'膽囊','duodenum':'十二指腸','small_bowel':'小腸','colon':'結腸','urinary_bladder':'膀胱','prostate':'攝護腺','kidney_cyst_left':'左腎囊腫','kidney_cyst_right':'右腎囊腫','sacrum':'薦骨','sternum':'胸骨','portal_vein_and_splenic_vein':'肝門靜脈與脾靜脈','lung_upper_lobe_left':'左肺上葉','lung_lower_lobe_left':'左肺下葉','lung_upper_lobe_right':'右肺上葉','lung_middle_lobe_right':'右肺中葉','lung_lower_lobe_right':'右肺下葉','costal_cartilages':'肋軟骨'}
paired={'kidney':'腎臟','adrenal_gland':'腎上腺','hip':'髖骨','femur':'股骨','humerus':'肱骨','scapula':'肩胛骨','clavicula':'鎖骨','iliac_artery':'髂動脈','iliac_vena':'髂靜脈','iliopsoas':'髂腰肌','gluteus_maximus':'臀大肌','gluteus_medius':'臀中肌','gluteus_minimus':'臀小肌','autochthon':'豎脊肌群','common_carotid_artery':'總頸動脈','subclavian_artery':'鎖骨下動脈','brachiocephalic_vein':'頭臂靜脈','tibia':'脛骨','fibula':'腓骨','patella':'髕骨','talus':'距骨','calcaneus':'跟骨'}
for en,zh in paired.items():
 for side,ch in [('left','左'),('right','右')]:names[en+'_'+side]=ch+zh
for p,ch,n in [('C','頸椎',7),('T','胸椎',12),('L','腰椎',6),('S','薦椎',1)]:
 for k in range(1,n+1):names[f'vertebrae_{p}{k}']=f'第{k}{ch}'
for side,ch in [('left','左'),('right','右')]:
 for k in range(1,13):names[f'rib_{side}_{k}']=f'{ch}第{k}肋骨'
for en,ch in {'tibia':'脛骨','fibula':'腓骨','patella':'髕骨','tarsal':'跗骨','metatarsal':'蹠骨','phalanges_feet':'足趾骨','radius':'橈骨','ulna':'尺骨','carpal':'腕骨','metacarpal':'掌骨','phalanges_hand':'指骨'}.items():names[en]=ch
def category(key):
 if key.startswith(('vertebrae_','rib_')) or key in {'skull','sacrum','sternum','costal_cartilages'} or any(x in key for x in ['femur','humerus','hip_','scapula','clavicula','tibia','fibula','patella','talus','calcaneus','tarsal','metatarsal','phalanges','radius','ulna','carpal']): return '骨骼'
 if any(x in key for x in ['autochthon','gluteus','iliopsoas']): return '肌肉'
 if key in {'brain','spinal_cord'}: return '神經'
 if key.startswith('lung_') or key=='trachea': return '呼吸'
 if any(x in key for x in ['artery','vena','vein','aorta','brachiocephalic_trunk']) or key in {'heart','atrial_appendage_left'}: return '心血管'
 if key.startswith('kidney_cyst'): return '其他'
 if key.startswith(('kidney_','adrenal_')) or key in {'urinary_bladder','prostate'}: return '泌尿生殖'
 return '內臟'
catalog=[]
for sid,title,spacing in [('s0327','頸根部・胸部・腹部・骨盆（增強）',3),('s1456','頭部 CT（主要構造）',1.5),('s1438','膝關節 CT（局部下肢）',1.5)]:
 folder=root/sid
 src=nib.load(str(folder/'ct.nii.gz'))
 ct=resample_to_output(src,voxel_sizes=(spacing,)*3,order=1,cval=-1024)
 hu=np.clip(np.rint(ct.get_fdata()),-32768,32767).astype('<i2')
 seg=np.zeros(hu.shape,dtype='uint8'); organs=[]
 for f in sorted((folder/'segmentations').glob('*.nii.gz')):
  en=f.name[:-7]
  if en not in names:continue
  mask=resample_from_to(nib.load(str(f)),ct,order=0).get_fdata()>0
  coords=np.where(mask)
  if not len(coords[0]):continue
  ident=len(organs)+1
  if ident>255:raise ValueError('Too many labels')
  seg[mask]=ident
  hue=(ident*.61803398875)%1;rgb=[round(v*255) for v in colorsys.hsv_to_rgb(hue,.65,.95)]
  med=np.array([np.median(v) for v in coords]); distances=sum((coords[k]-med[k])**2 for k in range(3)); nearest=int(np.argmin(distances)); center=[int(v[nearest]) for v in coords]
  organs.append({'id':ident,'name':names[en],'key':en,'category':category(en),'color':rgb,'center':center,'bounds':[[int(v.min()),int(v.max())] for v in coords]})
 for suffix,a in [('ct',hu),('seg',seg)]:
  with gzip.open(out/f'{sid}-{suffix}.gz','wb') as f:f.write(a.tobytes(order='F'))
 meta={'id':sid,'title':title,'shape':hu.shape,'spacing':[spacing]*3,'organs':organs,'sourceShape':src.shape,'sourceSpacing':[float(x) for x in src.header.get_zooms()[:3]],'contrast':'增強・血管攝影' if sid=='s0327' else '原資料未提供顯影期相','license':'CC BY 4.0','source':'https://zenodo.org/records/22688904'}
 (out/f'{sid}.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf8')
 catalog.append({k:meta[k] for k in ['id','title','contrast']})
 print(sid,hu.shape,len(organs),'organs',flush=True)
 # Produce an exact coronal slice for visual verification, not generated imagery.
 from PIL import Image
 layer=np.flip(hu[:,hu.shape[1]//2,:].T,(0,1)); gray=np.clip((layer+160)/400*255,0,255).astype('uint8')
 Image.fromarray(gray).save('/workspace/scratch/4824a0c92786/'+sid+'-coronal.png')
 (out/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False),encoding='utf8')
