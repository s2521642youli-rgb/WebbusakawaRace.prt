import * as THREE from 'three';

// 比較試作用。キャラクター形状・レース時計・保存データには触れない。
export const raceVisualStyleConfig={
  seed:21022,
  terrainSegments:28,          // 小さいほど大きな三角形の面になる
  hillHeight:1.05,              // キャラ全高に対する背景の起伏。走路は変更しない
  textureSize:128,
  brushStrength:.055,          // Painterlyの局所的な筆ムラ。画面全体には適用しない
  camera:{elevation:.34,startElevation:.28,maxDistance:16,followPerSecond:2.2}, // Painterly専用。距離は全高の倍数
  lowPoly:{sky:0xdde9ee,grass:0xa7c3a2,track:0xdbc9a7,leaf:0x82aa91,rock:0xb9b2b2,trunk:0xa08a74,faceVariation:.09,hemi:2.0,key:2.0},
  painterly:{sky:0xe5e9e9,grass:0xb0c6b2,track:0xe0cbb6,leaf:0x9ab8ad,rock:0xc9b9be,trunk:0xb1a08d,faceVariation:.018,hemi:1.65,key:2.05}
};
const modes=new Set(['original','low-poly','painterly-low-poly']);
function seeded(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

export function createRaceVisualStyles({scene,hemisphere,directional}){
  const original={background:scene.background,sky:hemisphere.color.clone(),ground:hemisphere.groundColor.clone(),hemi:hemisphere.intensity,keyColor:directional.color.clone(),key:directional.intensity};
  let records=[],course=null,mode='original',prepared=false;
  const styles=new Map(),geometries=new Set(),materials=new Set(),textures=new Set();
  const ownGeometry=g=>{geometries.add(g);return g;},ownMaterial=m=>{materials.add(m);return m;};

  function restore(){
    for(const record of records){record.mesh.geometry=record.geometry;record.mesh.material=record.material;record.mesh.visible=record.visible;}
    for(const entry of styles.values())entry.environment.visible=false;
    scene.background=original.background;
    hemisphere.color.copy(original.sky);hemisphere.groundColor.copy(original.ground);hemisphere.intensity=original.hemi;
    directional.color.copy(original.keyColor);directional.intensity=original.key;
  }
  function clear(){
    restore();for(const entry of styles.values()){scene.remove(entry.environment);entry.environment.traverse(mesh=>{if(mesh.isInstancedMesh)mesh.dispose();});}
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
    styles.clear();geometries.clear();materials.clear();textures.clear();records=[];prepared=false;
  }
  // 空間に固定した連続ノイズ。三角形やUVの扇状分割に依存しない。
  function noise(x,z,seed=0){
    const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz;
    const hash=(a,b)=>{let n=Math.imul(a+seed,374761393)^Math.imul(b,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
    const a=u*u*(3-2*u),b=v*v*(3-2*v);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iz),hash(ix+1,iz),a),THREE.MathUtils.lerp(hash(ix,iz+1),hash(ix+1,iz+1),a),b);
  }
  function brushTexture(){
    const size=raceVisualStyleConfig.textureSize,data=new Uint8Array(size*size*4),random=seeded(raceVisualStyleConfig.seed);
    // 周期端を一致させた不規則な水彩の濃淡。規則的な筆線・粒ノイズは加えない。
    const knots=Array.from({length:64},()=>random()),smooth=t=>t*t*(3-2*t);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const u=x/size*8,v=y/size*8,ix=Math.floor(u),iy=Math.floor(v),a=smooth(u-ix),b=smooth(v-iy);
      const knot=(i,j)=>knots[(j%8)*8+i%8];
      const n=THREE.MathUtils.lerp(THREE.MathUtils.lerp(knot(ix,iy),knot(ix+1,iy),a),THREE.MathUtils.lerp(knot(ix,iy+1),knot(ix+1,iy+1),a),b);
      const value=Math.round(255*(1-raceVisualStyleConfig.brushStrength*(.2+.8*n)));
      const offset=(y*size+x)*4;data[offset]=value;data[offset+1]=value;data[offset+2]=value;data[offset+3]=255;
    }
    const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
    texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;textures.add(texture);return texture;
  }
  function coloredGeometry(source,color,variation,seed,worldUV=false){
    const g=ownGeometry(source.index?source.toNonIndexed():source.clone()),p=g.getAttribute('position');
    const values=new Float32Array(p.count*3),uv=worldUV?new Float32Array(p.count*2):null;
    const random=seeded(seed),base=new THREE.Color(color),c=new THREE.Color();
    for(let i=0;i<p.count;i+=3){
      c.copy(base).multiplyScalar(1+(random()-.5)*variation*2);
      for(let j=i;j<Math.min(i+3,p.count);j++){
        c.toArray(values,j*3);if(uv){uv[j*2]=p.getX(j)/(course.height*8);uv[j*2+1]=p.getZ(j)/(course.height*8);}
      }
    }
    g.setAttribute('color',new THREE.BufferAttribute(values,3));if(uv)g.setAttribute('uv',new THREE.BufferAttribute(uv,2));return g;
  }
  function groundHeight(x,z){
    const h=course.height,edge=Math.hypot(Math.max(Math.abs(x)-course.halfStraight,0),z);
    const outside=THREE.MathUtils.smoothstep(edge,course.curveRadius+course.width/2+h*.4,course.curveRadius+course.width/2+h*3.5);
    return -h*.04+outside*h*raceVisualStyleConfig.hillHeight*(.2+.8*noise(x/h*.19,z/h*.19,21));
  }
  function environment(palette,paint,texture){
    const group=new THREE.Group();group.name='visualStyleEnvironment';group.visible=false;
    const h=course.height,width=(course.halfStraight+course.curveRadius+course.width)*2;
    const plane=new THREE.PlaneGeometry(width,width,raceVisualStyleConfig.terrainSegments,raceVisualStyleConfig.terrainSegments);plane.rotateX(-Math.PI/2);
    const p=plane.getAttribute('position'),random=seeded(72),step=width/raceVisualStyleConfig.terrainSegments;
    for(let i=0;i<p.count;i++){
      let x=p.getX(i),z=p.getZ(i);
      // 格子を崩し、色差でなく自然な傾斜で面を見せる。走路の高さは元のまま。
      if(Math.abs(x)<width/2-.01)x+=(random()-.5)*step*.65;
      if(Math.abs(z)<width/2-.01)z+=(random()-.5)*step*.65;
      p.setXYZ(i,x,groundHeight(x,z),z);
    }
    plane.computeVertexNormals();
    const terrain=coloredGeometry(plane,palette.grass,0,raceVisualStyleConfig.seed,true);plane.dispose();
    const tc=terrain.getAttribute('color'),tp=terrain.getAttribute('position'),base=new THREE.Color(palette.grass),shade=new THREE.Color();
    for(let i=0;i<tp.count;i++){
      shade.copy(base).multiplyScalar(1+(noise(tp.getX(i)/h*.18,tp.getZ(i)/h*.18,91)-.5)*.055);
      tc.setXYZ(i,shade.r,shade.g,shade.b);
    }
    const material=ownMaterial(new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1,flatShading:true,map:texture}));
    group.add(new THREE.Mesh(terrain,material));
    const a=course.halfStraight,r=course.curveRadius,w=course.width/2;
    // 背景の外周だけに置く。走路から距離をとった控えめな植生。歩行範囲へは置かない。
    const trees=[[-a-r-w-h*1.5,-r*.4],[-a-r-w-h*1.7,r*.65],[-a*.9,-r-w-h*2],[a*.6,-r-w-h*2.7],[-a-r*.45,-r-w-h*3]];
    function instances(source,color,positions,scale,yOffset,seed){
      const geometry=coloredGeometry(source,color,palette.faceVariation,seed);source.dispose();
      const mesh=new THREE.InstancedMesh(geometry,material,positions.length),transform=new THREE.Object3D(),random=seeded(seed);
      for(let i=0;i<positions.length;i++){
        const [x,z]=positions[i],individual=.75+random()*.55;
        transform.position.set(x,groundHeight(x,z)+yOffset*h*individual,z);transform.rotation.set(0,random()*Math.PI*2,0);
        transform.scale.set(scale[0]*h*individual,scale[1]*h*individual,scale[2]*h*individual);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
      }
      mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);
    }
    instances(new THREE.CylinderGeometry(.07,.12,1.35,6),palette.trunk,trees,[1,1,1],.675,11);
    instances(new THREE.IcosahedronGeometry(.72,1),palette.leaf,trees,[1,1.4,1],1.65,12);
    const rocks=[[-a-r-w-h*.8,h],[-a*1.4,-r-w-h],[-a*.2,-r-w-h*1.3],[a*.9,-r-w-h*1.3],[-a-r-w-h*1.6,-r]];
    instances(new THREE.IcosahedronGeometry(.48,0),palette.rock,rocks,[1.35,.85,1],.3,13);
    const bushes=[[-a-r-w-h*.8,-r*.6],[-a*.7,-r-w-h],[a*.3,-r-w-h*1.5],[-a-r-w-h*.7,r*.75]];
    instances(new THREE.IcosahedronGeometry(.38,1),palette.leaf,bushes,[1.6,.9,1],.23,14);
    return group;
  }
  function build(name){
    const paint=name==='painterly-low-poly',palette=paint?raceVisualStyleConfig.painterly:raceVisualStyleConfig.lowPoly;
    const texture=paint?brushTexture():null,materialCache=new Map(),changes=[];
    function characterMaterial(source){
      if(materialCache.has(source))return materialCache.get(source);
      const material=ownMaterial(source.clone());
      // 頂点・スキン・顔の凹凸は変更せず、白い材質だけを控えめに調整する。
      material.flatShading=!paint;
      if('roughness'in material)material.roughness=paint ? .95 : .85;
      if('metalness'in material)material.metalness=0;
      if(paint&&material.color)material.color.lerp(new THREE.Color(0xfffbf4),.12);
      material.needsUpdate=true;materialCache.set(source,material);return material;
    }
    for(const record of records){
      if(record.role==='grass')continue;
      if(record.role==='track'){
        // ゴール白線と境界線はオリジナルの描画順・深度設定・白さをそのまま保つ。
        if(record.material.color?.getHex()===0xffffff)continue;
        const geometry=coloredGeometry(record.geometry,palette.track,0,42,true),material=ownMaterial(record.material.clone());
        material.color.set(0xffffff);material.vertexColors=true;material.flatShading=false;material.roughness=1;material.map=texture;material.needsUpdate=true;
        changes.push({mesh:record.mesh,geometry,material});
      }else changes.push({mesh:record.mesh,geometry:record.geometry,material:Array.isArray(record.material)?record.material.map(characterMaterial):characterMaterial(record.material)});
    }
    const background=environment(palette,paint,texture);scene.add(background);
    const result={changes,environment:background,palette,paint};styles.set(name,result);return result;
  }
  function setStyle(name){
    if(!modes.has(name))throw new Error('表示スタイルを確認してね。');
    mode=name;if(!prepared)return mode;restore();if(name==='original')return mode;
    const entry=styles.get(name)??build(name);
    for(const change of entry.changes){change.mesh.geometry=change.geometry;change.mesh.material=change.material;}
    for(const record of records)if(record.role==='grass')record.mesh.visible=false;
    entry.environment.visible=true;scene.background=new THREE.Color(entry.palette.sky);
    hemisphere.color.set(entry.paint?0xfff5e7:0xf5f7f3);hemisphere.groundColor.set(entry.paint?0xbeb5bb:0xabb5a6);hemisphere.intensity=entry.palette.hemi;
    directional.color.set(entry.paint?0xffe8d0:0xfff4e0);directional.intensity=entry.palette.key;
    return mode;
  }
  return {
    prepare({course:nextCourse,trackObjects,backgroundObjects,racers}){
      const selected=mode;clear();course=nextCourse;
      const capture=(root,role)=>root.traverse(mesh=>{if(mesh.isMesh)records.push({mesh,role,geometry:mesh.geometry,material:mesh.material,visible:mesh.visible});});
      capture(backgroundObjects,'grass');capture(trackObjects,'track');for(const item of racers)capture(item.group,'character');
      prepared=true;setStyle(selected);
    },
    setStyle,
    dispose:clear,
    getStats:()=>({mode,variants:styles.size,geometries:geometries.size,materials:materials.size,textures:textures.size,backgroundDrawCalls:mode==='original'?0:5})
  };
}
