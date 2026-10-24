import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const prepare=fileURLToPath(new URL("./prepare-cloudflare.mjs",import.meta.url));
const wrangler=fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js",import.meta.url));

function run(command,args){
  const result=spawnSync(command,args,{stdio:"inherit",env:{...process.env,CI:"1"}});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}

run(process.execPath,[prepare]);
// Apply the game's complete schema before the new Worker can receive traffic.
run(process.execPath,[wrangler,"d1","migrations","apply","DB","--remote","--config","dist/server/wrangler.json"]);
run(process.execPath,[wrangler,"deploy","--config","dist/server/wrangler.json"]);
