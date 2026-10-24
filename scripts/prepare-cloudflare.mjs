import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const configPath=resolve("dist/server/wrangler.json");
const databaseId=process.env.PEARSON_D1_DATABASE_ID;
const workerName=process.env.PEARSON_WORKER_NAME || "pearson-market";
if(!databaseId||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(databaseId)
  ||databaseId==="00000000-0000-4000-8000-000000000000")
  throw new Error("Set PEARSON_D1_DATABASE_ID to the UUID from Cloudflare D1. Refusing to deploy the Sites placeholder binding.");
if(!/^[a-z][a-z0-9-]{2,62}$/.test(workerName))
  throw new Error("PEARSON_WORKER_NAME must be a valid Cloudflare Worker name.");

const config=JSON.parse(readFileSync(configPath,"utf8"));
if(!config.main||!config.assets?.directory)throw new Error("Vinext Worker build output is incomplete.");
config.name=workerName;
config.d1_databases=[{binding:"DB",database_name:"pearson-market",database_id:databaseId,
  migrations_dir:"../../drizzle"}];
config.vars={...config.vars,GAME_AUTH_MODE:"guest"};
writeFileSync(configPath,JSON.stringify(config,null,2)+"\n");
process.stdout.write(`Cloudflare Worker ${workerName} configured with D1 binding DB and guest sessions.\n`);
