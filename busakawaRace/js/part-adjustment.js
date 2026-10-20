import * as THREE from 'three';
// 倍率はモデル定義に対する相対値。旧データは倍率1・傾き0で従来と同じ見た目。
export const partAdjustmentConfig={scale:{min:.25,max:3,step:.05,initial:1},tilt:{min:-80,max:80,step:1,initial:0}};
export function readPartAdjustment(saved={},settings={}){
  return {scale:settings.scaleLocked?settings.fixedScale:Number.isFinite(saved.scale)?THREE.MathUtils.clamp(saved.scale,partAdjustmentConfig.scale.min,partAdjustmentConfig.scale.max):1,
    tilt:settings.tiltLocked?settings.fixedTilt:Number.isFinite(saved.tilt)?THREE.MathUtils.clamp(saved.tilt,partAdjustmentConfig.tilt.min,partAdjustmentConfig.tilt.max):0};
}
// サイズと傾きに合わせた外形・厚み。表面サンプリングと復元の両方に使う。
export function adjustedPartBounds(box,scale,tilt){
  return box.clone().applyMatrix4(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(tilt)).scale(new THREE.Vector3(scale,scale,scale)));
}
export function applyPartAdjustment(group,scale,tilt){
  group.scale.setScalar(scale);
  group.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),THREE.MathUtils.degToRad(tilt)));
}
