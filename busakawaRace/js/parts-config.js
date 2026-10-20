// モデルの種類。IDは保存データの参照キーなので変更しない。
// パスは3つのHTMLが置かれたプロジェクトルートからの相対パス。
export const partSettings = {
  eye_01:{id:'eye_01',category:'eyes',label:'eye_01',path:'./assets/eyes/eye_01.glb',sizeMultiplier:.48,fixedDepth:-.1},
  eye_02:{id:'eye_02',category:'eyes',label:'eye_02',path:'./assets/eyes/eye_02.glb',sizeMultiplier:.48,fixedDepth:-.1},
  eye_03:{id:'eye_03',category:'eyes',label:'eye_03',path:'./assets/eyes/eye_03.glb',sizeMultiplier:.48,fixedDepth:-.26,depthLocked:true,fixedScale:1.10,scaleLocked:true,fixedTilt:0,tiltLocked:true,hideAdjustmentControls:true},
  eye_04:{id:'eye_04',category:'eyes',label:'eye_04',path:'./assets/eyes/eye_04.glb',sizeMultiplier:.48,fixedDepth:-.26,depthLocked:true,fixedScale:1.10,scaleLocked:true,fixedTilt:0,tiltLocked:true,hideAdjustmentControls:true},
  mouth_01:{id:'mouth_01',category:'mouth',label:'mouth_01',path:'./assets/mouths/mouth_01.glb',sizeMultiplier:.55,fixedDepth:-.1},
  mouth_02:{id:'mouth_02',category:'mouth',label:'mouth_02',path:'./assets/mouths/mouth_02.glb',sizeMultiplier:1.10,fixedDepth:-.13,depthLocked:true},
  mouth_03:{id:'mouth_03',category:'mouth',label:'mouth_03',path:'./assets/mouths/mouth_03.glb',sizeMultiplier:.715,fixedDepth:-.16,depthLocked:true},
  // mouth_04・mouth_05は調整画面で決めた深さ・追加倍率・前後傾きを固定。
  mouth_04:{id:'mouth_04',category:'mouth',label:'mouth_04',path:'./assets/mouths/mouth_04.glb',sizeMultiplier:.55,fixedDepth:-.30,depthLocked:true,fixedScale:1.55,scaleLocked:true,fixedTilt:-28,tiltLocked:true,hideAdjustmentControls:true},
  mouth_05:{id:'mouth_05',category:'mouth',label:'mouth_05',path:'./assets/mouths/mouth_05.glb',sizeMultiplier:.55,fixedDepth:-.25,depthLocked:true,fixedScale:1.40,scaleLocked:true,fixedTilt:0,tiltLocked:true,hideAdjustmentControls:true}
};
// 取り付け位置（旧保存キーを維持）。モデルIDとは別の概念。
export const slotDefinitions = {
  eye_01:{label:'目①',category:'eyes',type:'eye_01',setter:'setEye01Coordinates',defaults:{x:-.4,y:.1,rotation:0},sliders:['eyeX','eyeY','eyeDepth','eyeRotation']},
  eye_02:{label:'目②',category:'eyes',type:'eye_02',setter:'setEye02Coordinates',defaults:{x:.4,y:.1,rotation:0},sliders:['eye02X','eye02Y','eye02Depth','eye02Rotation']},
  mouth_01:{label:'口',category:'mouth',type:'mouth_01',setter:'setMouthCoordinates',defaults:{x:0,y:-.35,rotation:0},sliders:['mouthX','mouthY','mouthDepth','mouthRotation']}
};
export const partSlots=Object.keys(slotDefinitions);
const categoryLabels={eyes:'目',mouth:'口'};
export const partCategories=Object.fromEntries(Object.entries(categoryLabels).map(([id,label])=>[id,{
  label,slots:partSlots.filter(slot=>slotDefinitions[slot].category===id),
  models:Object.keys(partSettings).filter(type=>partSettings[type].category===id)
}]));
// マーカー割り当て。既存0/1/2はモデルを強制せず、現在選択中の形を動かす。
// 新IDで形も切り替える場合: 3:{slot:'mouth_01',model:'mouth_04'} を追加する。
export const arucoMarkerBindings={0:{slot:'eye_01'},1:{slot:'eye_02'},2:{slot:'mouth_01'}};
export const markerSetters=Object.fromEntries(Object.entries(arucoMarkerBindings).map(([id,binding])=>[id,slotDefinitions[binding.slot].setter]));
for(const [id,model] of Object.entries(partSettings)){
  if(id!==model.id||!partCategories[model.category]||!Number.isFinite(model.sizeMultiplier)||model.sizeMultiplier<=0||!Number.isFinite(model.fixedDepth))throw new Error('パーツ定義を確認してね: '+id);
}
for(const [id,binding] of Object.entries(arucoMarkerBindings)){
  if(!slotDefinitions[binding.slot]||(binding.model&&partSettings[binding.model]?.category!==slotDefinitions[binding.slot].category))throw new Error('ArUcoの割り当てを確認してね: '+id);
}
