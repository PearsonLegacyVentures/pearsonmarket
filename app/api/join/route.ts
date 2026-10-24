import { env } from "cloudflare:workers";
import { gameAuthMode, hashToken, newSessionToken, SESSION_COOKIE, SESSION_LIFETIME_MS } from "../../../lib/game-auth";

export const dynamic="force-dynamic";

export async function POST(request:Request) {
  if(gameAuthMode()!=="guest")return Response.json({error:"Guest registration is disabled."},{status:404});
  if(!env.DB)return Response.json({error:"The game database is not connected."},{status:503});
  const origin=request.headers.get("Origin");
  if(origin&&origin!==new URL(request.url).origin)return Response.json({error:"Invalid request origin."},{status:403});
  try {
    const payload=await request.json() as {name?:unknown};
    const name=typeof payload.name==="string"?payload.name.trim().replace(/\s+/g," "):"";
    if(!/^[\p{L}\p{N} _.'-]{2,24}$/u.test(name))
      return Response.json({error:"Choose a name of 2–24 letters or numbers."},{status:400});
    const token=newSessionToken();
    const now=Date.now();
    await env.DB.prepare("INSERT INTO guest_sessions (token_hash,user_id,display_name,expires_at,created_at) VALUES (?,?,?,?,?)")
      .bind(await hashToken(token),`GUEST_${crypto.randomUUID()}`,name,now+SESSION_LIFETIME_MS,now).run();
    const secure=new URL(request.url).protocol==="https:"?" Secure;":"";
    return Response.json({ok:true},{headers:{
      "Set-Cookie":`${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_LIFETIME_MS/1000};${secure}`,
      "Cache-Control":"no-store",
    }});
  } catch (error) {
    console.error("Guest registration error",error);
    return Response.json({error:"Could not join the market. Try again."},{status:500});
  }
}
