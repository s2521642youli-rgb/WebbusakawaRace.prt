// ページごとのテンプレートキャッシュ。呼び出し元でSkeletonUtils.cloneして使う。
// Promiseも共有するので同時に同じモデルを要求しても1回の読み込みになる。
export function createModelCache(loader){
  const templates=new Map();
  return function loadTemplate(path){
    if(!templates.has(path)){
      const promise=loader.loadAsync(path).then(gltf=>gltf.scene).catch(error=>{
        if(templates.get(path)===promise)templates.delete(path);
        throw new Error(`モデルを読み込めなかったよ: ${path}（${error.message??'読み込みエラー'}）`);
      });templates.set(path,promise);
    }
    return templates.get(path);
  };
}
