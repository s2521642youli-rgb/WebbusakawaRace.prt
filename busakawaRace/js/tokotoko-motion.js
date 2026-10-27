import * as THREE from 'three';

// 移動・順位・転倒から独立した足運び。Bodyと顔には触れない。
export function captureTokotokoRig(rig) {
  rig.tokotokoScratch=Object.fromEntries(['target','current','parentTarget','parentCurrent','correction'].map(key=>[key,new THREE.Vector3()]));
  rig.tokotoko=rig.legs.map(leg=>({restFoot:leg.foot.bone.getWorldPosition(new THREE.Vector3())}));
}
export function advanceTokotokoPhase(item,motion,config,dt) {
  const h=item.surface.maxSize;
  motion.deltaSeconds=Math.max(0,dt);
  // 短い脚の骨長で周期を決めると高速な足踏みになるため、全高基準の一周期距離を使う。
  const stride=h*config.cycleDistance*motion.profile.stride;
  motion.cycleDistance=stride;
  motion.phase+=Math.min(motion.speed/Math.max(stride,1e-6),config.maxCyclesPerSecond)*Math.max(0,dt)*Math.PI*2;
}
const smooth=t=>t*t*t*(t*(t*6-15)+10);
function swingForward(u,stroke,stance) {
  // 前後の接地速度を引き継ぐHermite曲線。離地・着地で急に反転しない。
  const m=-stroke*(1-stance)/stance;
  return (2*u**3-3*u*u+1)*(-stroke/2)+(u**3-2*u*u+u)*m+(-2*u**3+3*u*u)*(stroke/2)+(u**3-u*u)*m;
}
export function applyTokotokoPose(item,motion,config,weight) {
  const rig=item.legRig,h=item.surface.maxSize;
  if(!rig.tokotoko)return;
  if(!motion.feet)motion.feet=rig.legs.map(()=>({anchor:null,previousCycle:null}));
  const active=motion.speed>h*.015&&weight>.15&&!motion.suspendPlant;
  const stance=THREE.MathUtils.clamp(config.stanceRatio,.52,.7);
  const stride=motion.cycleDistance??h*config.cycleDistance*motion.profile.stride,stroke=stride*stance;
  const {target,current,parentTarget,parentCurrent,correction}=rig.tokotokoScratch;
  for(let i=0;i<rig.legs.length;i++) {
    const leg=rig.legs[i],footState=motion.feet[i],rest=rig.tokotoko[i].restFoot;
    const cycle=((motion.phase/(Math.PI*2)+i*.5)%1+1)%1;
    const planted=cycle<stance,u=planted?cycle/stance:(cycle-stance)/(1-stance);
    const arc=planted?0:16*u*u*(1-u)*(1-u);
    const forward=planted?stroke*(.5-u):swingForward(u,stroke,stance);
    const hip=-config.hipSwing*forward/(stroke*.5),knee=planted?.025*Math.sin(Math.PI*u)**2:config.kneeBend*arc;
    for(const [joint,angle] of [[leg.hip,hip],[leg.knee,knee],[leg.foot,-hip-knee]]){
      joint.delta.setFromAxisAngle(joint.axis,angle*weight);joint.bone.quaternion.copy(joint.rest).multiply(joint.delta);
    }
    leg.hip.bone.position.copy(leg.restPosition);
    item.group.updateMatrixWorld(true);
    target.copy(rest);target.z+=forward*weight;
    // 頭の弾みは足を下へ伸ばして作る。親の接地補正で体が上がり、支持足は浮かない。
    target.y+=(config.footLift*motion.profile.lift*arc*weight*h)-(motion.bob??0);
    item.modelSpace.localToWorld(target);
    const wrapped=footState.previousCycle!==null&&cycle<footState.previousCycle;
    const entered=footState.previousCycle===null||footState.previousCycle>=stance||wrapped;
    if(planted&&active){
      if(entered||!footState.anchor)footState.anchor=target.clone();
      const lock=smooth(THREE.MathUtils.clamp((weight-.15)/.65,0,1))*(1-smooth(THREE.MathUtils.clamp((u-.88)/.12,0,1))); // 蹴り出しの最後で滑らかに離す
      target.x=THREE.MathUtils.lerp(target.x,footState.anchor.x,lock);target.z=THREE.MathUtils.lerp(target.z,footState.anchor.z,lock);
    }else footState.anchor=null;
    // 速度変更や離地時の残差を数フレームになじませ、足先の急な追いつきを抑える。
    if(!footState.filtered)footState.filtered=target.clone();
    const dt=motion.deltaSeconds??0;
    if(dt>0&&weight>0&&!motion.suspendPlant&&!footState.wasSuspended)footState.filtered.lerp(target,1-Math.exp(-dt/config.footResponseSeconds));
    else footState.filtered.copy(target);
    footState.wasSuspended=motion.suspendPlant;target.copy(footState.filtered);
    leg.foot.bone.getWorldPosition(current);
    // 短い脚で届かない目標を無理に追わない。急旋回・停止では小さな滑りを許して破綻を防ぐ。
    correction.copy(target).sub(current).clampLength(0,h*config.maxFootCorrection*weight);
    parentTarget.copy(current).add(correction);leg.hip.bone.parent.worldToLocal(parentTarget);
    parentCurrent.copy(current);leg.hip.bone.parent.worldToLocal(parentCurrent);
    leg.hip.bone.position.add(parentTarget.sub(parentCurrent));
    leg.hip.bone.updateMatrixWorld(true);
    footState.previousCycle=cycle;
  }
}
