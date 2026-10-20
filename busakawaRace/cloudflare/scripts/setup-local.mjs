import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
try {
  await writeFile(new URL('../.dev.vars',import.meta.url),'ADMIN_TOKEN='+randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
  console.log('.dev.varsを作成したよ。ファイル内のADMIN_TOKENをPCの管理画面へ入力してね。Gitには含まれないよ。');
} catch(error){if(error.code==='EEXIST')console.log('.dev.varsは既にあるので変更していないよ。');else throw error;}
